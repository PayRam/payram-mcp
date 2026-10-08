import net from 'node:net';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../utils/logger.js';
import { safeHandler } from './common/errors.js';
import {
  getOptionalPayramAccessToken,
  getOptionalPayramApiKey,
  getOptionalPayramBaseUrl,
} from '../config/env.js';
import { isLoopbackHost } from '../config/runtime.js';
import { getSiteUrl, getWallets } from '../api/payramApi.js';
import {
  excerpt,
  parseBaseUrl,
  probePort,
  safeFetch,
  UnsafeUrlError,
  type PortState,
  type SafeFetchResult,
} from '../utils/safeFetch.js';
import { getLatestCoreVersion, compareVersions } from '../utils/releases.js';
import { CONTAINER, INSTALL, isProgramDown } from '../facts/payram.js';
import { textContent } from './common/content.js';

/**
 * payram_doctor — staged, side-effect-free diagnosis of a PayRam server.
 *
 * Public stages need no credentials and work from the hosted MCP:
 *   reachability → health → TLS → version → workers.
 * Optional stages: API-key validity (a deliberately invalid body, so nothing
 * is ever created) and, in local mode with a JWT, site URL and wallets.
 * Never throws for missing configuration: it reports what it could check.
 */

const findingSchema = z.object({
  check: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

const causeSchema = z.object({
  likelihood: z.string().describe('Rough probability, e.g. "60%"'),
  cause: z.string(),
  fix: z.string().describe('The exact command or action that resolves it'),
});

const inputSchema = z.object({
  baseUrl: z
    .string()
    .optional()
    .describe(
      'Public address of the PayRam server, same origin as the dashboard: https://pay.example.com, or just pay.example.com or an IP (https is tried first, then http). No :8080, no path. Required on the hosted MCP.',
    ),
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional project API key to validate (never creates anything). Passing it puts the key in this conversation; prefer running payram_ops_playbook "connect" locally.',
    ),
});

const outputSchema = z.object({
  baseUrl: z.string().nullable(),
  healthy: z.boolean(),
  failedStage: z.string().nullable().describe('First failing stage, null when healthy'),
  version: z.string().nullable(),
  latestVersion: z.string().nullable(),
  findings: z.array(findingSchema),
  warnings: z.array(z.string()),
  likelyCauses: z.array(causeSchema).describe('Ranked causes for the first failing stage'),
  nextSteps: z.array(z.string()),
  setupStage: z
    .literal('installed')
    .nullable()
    .describe(
      'Pass as payram_setup_plan stage once the server answers PayRam health; null when not reachable',
    ),
  nextCall: z
    .object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) })
    .nullable()
    .describe('The single most useful tool call to make next'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;
type Cause = z.infer<typeof causeSchema>;

const render = (out: Output): string => {
  const lines = [`=== PayRam doctor${out.baseUrl ? `: ${out.baseUrl}` : ''} ===`];
  for (const f of out.findings) lines.push(`${f.ok ? 'PASS' : 'FAIL'}  ${f.check} - ${f.detail}`);
  for (const w of out.warnings) lines.push(`WARN  ${w}`);
  if (out.healthy) {
    lines.push('', 'Public checks passed.');
  } else {
    lines.push('', `Failed at: ${out.failedStage}`, 'Likely causes:');
    for (const c of out.likelyCauses)
      lines.push(`  [${c.likelihood}] ${c.cause}`, `         -> ${c.fix}`);
  }
  if (out.nextSteps.length) lines.push('', 'Next steps:', ...out.nextSteps.map((s) => `  - ${s}`));
  if (out.nextCall)
    lines.push('', `Next call: ${out.nextCall.tool} ${JSON.stringify(out.nextCall.arguments)}`);
  return lines.join('\n');
};

type FailureKind =
  'dns' | 'wrong-protocol' | 'tls' | 'refused' | 'timeout' | 'reset' | 'private' | 'other';

const classifyFailure = (error: unknown): FailureKind => {
  if (error instanceof UnsafeUrlError) return 'private';
  const code = (error as NodeJS.ErrnoException)?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code) || /ENOTFOUND|EAI_AGAIN/.test(message)) return 'dns';
  if (
    /WRONG_VERSION_NUMBER|wrong version number|packet length too long/i.test(`${code} ${message}`)
  )
    return 'wrong-protocol';
  if (/CERT|SSL|TLS|self.signed|unable to verify|expired/i.test(`${code} ${message}`)) return 'tls';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ETIMEDOUT' || /timed out/i.test(message)) return 'timeout';
  if (/^(ECONNRESET|EPIPE)$/.test(code) || /socket hang up/i.test(message)) return 'reset';
  return 'other';
};

const portsSummary = (ports: Map<number, PortState>): string =>
  [...ports].map(([port, state]) => `${port} ${state === 'open' ? 'open' : state}`).join(', ');

/** Ranked causes for a connection that failed, using what the port probe found. */
const networkCauses = (
  base: URL,
  kind: FailureKind,
  ports: Map<number, PortState>,
): { causes: Cause[]; troubleshootId: string | null } => {
  const open = [...ports].filter(([, s]) => s === 'open').map(([p]) => p);
  switch (kind) {
    case 'private':
      return {
        causes: [
          {
            likelihood: '100%',
            cause: 'The address is private/internal; the hosted MCP only checks public servers',
            fix: 'Use the public address, or run the check on the server: curl -s http://localhost/api/v1/health (payram_ops_playbook "health")',
          },
        ],
        troubleshootId: null,
      };
    case 'dns':
      return {
        causes: [
          {
            likelihood: '90%',
            cause: `DNS for ${base.hostname} does not resolve`,
            fix: `Create or fix the A record, then check: dig +short ${base.hostname}`,
          },
          {
            likelihood: '10%',
            cause: 'The hostname is misspelled',
            fix: 'Check the exact dashboard address',
          },
        ],
        troubleshootId: 'dns-not-pointing',
      };
    case 'wrong-protocol':
      return {
        causes: [
          {
            likelihood: '90%',
            cause: 'This server speaks plain HTTP on that port (SSL is not set up)',
            fix: `Use http://${base.host} for now, or add HTTPS: payram_runbook "ssl_setup"`,
          },
        ],
        troubleshootId: null,
      };
    case 'tls':
      return {
        causes: [
          {
            likelihood: '80%',
            cause: 'The TLS certificate is invalid, expired or for a different name',
            fix: 'payram_runbook "ssl_renewal_fix" (Let\'s Encrypt) or "ssl_setup"',
          },
          {
            likelihood: '20%',
            cause: 'A proxy in front presents its own certificate',
            fix: 'Check the proxy\'s SSL mode (payram_runbook "custom_port_or_proxy")',
          },
        ],
        troubleshootId: 'certificate-expired',
      };
    case 'refused':
      return {
        causes: [
          {
            likelihood: '70%',
            cause: open.length
              ? `Nothing listens on the port you used (open: ${open.join(', ')})`
              : 'Nothing is listening: the PayRam container is not running',
            fix: open.length
              ? `Use the open port's scheme (${open.includes(443) ? 'https' : 'http'}://${base.hostname}), without :8080/:8443`
              : `On the server: docker ps --filter name=${CONTAINER.name}; start it: ${INSTALL.restart}`,
          },
          {
            likelihood: '30%',
            cause: 'The wrong server address (an old IP, or a different machine)',
            fix: `Confirm the IP the domain points to: dig +short ${base.hostname}`,
          },
        ],
        troubleshootId: 'dashboard-unreachable',
      };
    case 'timeout':
      return {
        causes: open.length
          ? [
              {
                likelihood: '60%',
                cause: `Port ${open.join('/')} accepts connections but the request timed out: PayRam or the proxy in front is overloaded or still starting`,
                fix: `On the server: ${CONTAINER.supervisorctl}; wait 2 minutes after a restart`,
              },
              {
                likelihood: '40%',
                cause: 'A reverse proxy or CDN in front is not reaching PayRam',
                fix: 'payram_runbook "custom_port_or_proxy"',
              },
            ]
          : [
              {
                likelihood: '65%',
                cause: 'A firewall (cloud security group or ufw) silently drops 80/443',
                fix: 'Open inbound 80 and 443 in the cloud provider firewall and in ufw (payram_runbook "firewall_ports")',
              },
              {
                likelihood: '25%',
                cause: 'The server is down or the IP is wrong',
                fix: 'Check the machine is running and the domain points at its public IP',
              },
              {
                likelihood: '10%',
                cause: 'The PayRam container is not running',
                fix: `On the server: docker ps --filter name=${CONTAINER.name}; ${INSTALL.restart}`,
              },
            ],
        troubleshootId: 'dashboard-unreachable',
      };
    default:
      return {
        causes: [
          {
            likelihood: '50%',
            cause: 'The PayRam container is not running or is restarting',
            fix: `On the server: docker ps --filter name=${CONTAINER.name}; restart: ${INSTALL.restart}`,
          },
          {
            likelihood: '30%',
            cause: 'Port 80/443 blocked by a firewall, or the wrong port in the address',
            fix: `On the server: docker port ${CONTAINER.name}; open 80/443 in the cloud firewall`,
          },
        ],
        troubleshootId: 'dashboard-unreachable',
      };
  }
};

/** The server answered, but not with PayRam's health document. */
const notPayramCauses = (
  res: SafeFetchResult,
): { causes: Cause[]; troubleshootId: string | null } => {
  const viaCloudflare = 'cf-ray' in res.headers || /cloudflare/i.test(String(res.headers.server));
  if (viaCloudflare && res.status >= 520) {
    return {
      causes: [
        {
          likelihood: '70%',
          cause: `Cloudflare cannot reach or trust the server (error ${res.status})`,
          fix: '52x: check the container is up and 80/443 are open to Cloudflare; 525/526: set SSL mode Full/Full (strict)',
        },
        {
          likelihood: '30%',
          cause: 'The server IP in Cloudflare DNS is wrong',
          fix: 'Check the A record in Cloudflare points at the server',
        },
      ],
      troubleshootId: 'cloudflare-or-proxy-errors',
    };
  }
  if (res.status >= 502 && res.status <= 504) {
    return {
      causes: [
        {
          likelihood: '60%',
          cause: `The web server answers (HTTP ${res.status}) but PayRam behind it is starting, crashed or overloaded`,
          fix: `On the server: ${CONTAINER.supervisorctl}; give it 2 minutes after a restart`,
        },
        {
          likelihood: '40%',
          cause: 'A reverse proxy cannot reach PayRam',
          fix: 'payram_runbook "custom_port_or_proxy"',
        },
      ],
      troubleshootId: 'gateway-5xx',
    };
  }
  return {
    causes: [
      {
        likelihood: '50%',
        cause:
          'The address points at something other than PayRam (another site, a parked-domain page, or a very old install without /api/v1/health)',
        fix: 'Use the exact dashboard address; on the server check: curl -s http://localhost/api/v1/health',
      },
      {
        likelihood: '30%',
        cause: 'A reverse proxy is not forwarding /api/ to PayRam',
        fix: 'Forward all paths to http://<server>:80 and set X-Forwarded-Proto',
      },
      {
        likelihood: '20%',
        cause: 'The PayRam container is starting or crash-looping',
        fix: `On the server: docker ps --filter name=${CONTAINER.name}; tail ~/.payram-core/log/supervisord/*.err.log`,
      },
    ],
    troubleshootId: 'dashboard-unreachable',
  };
};

/**
 * Turn what the user typed into candidate base URLs. A bare host or IP gets
 * https first, then http; anything after the origin (a dashboard path) is dropped.
 */
const BARE_HOST = /^[a-z0-9.-]+(:\d{1,5})?([/?#].*)?$|^\[[0-9a-f:]+\](:\d{1,5})?([/?#].*)?$/i;
export const baseCandidates = (raw: string): { urls: URL[]; note?: string } => {
  const value = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && BARE_HOST.test(value)) {
    const urls = (['https', 'http'] as const).map((scheme) => parseBaseUrl(`${scheme}://${value}`));
    return {
      urls: urls.map((u) => withoutPath(u)),
      note: `No scheme given: tried https first, then http.`,
    };
  }
  const url = parseBaseUrl(value);
  return {
    urls: [withoutPath(url)],
    note:
      url.pathname && url.pathname !== '/'
        ? `Ignored the path ${url.pathname}: the API is at the site root.`
        : undefined,
  };
};

const withoutPath = (url: URL): URL => {
  const clean = new URL(url.href);
  clean.pathname = '';
  return clean;
};

const troubleshootCall = (id: string): Output['nextCall'] => ({
  tool: 'payram_troubleshoot',
  arguments: { id },
});

/** The most useful follow-up for a check that failed after the server answered. */
const nextCallForFailedCheck = (check: string): Output['nextCall'] => {
  switch (check) {
    case 'tls':
      return troubleshootCall('certificate-expired');
    case 'workers':
      return troubleshootCall('worker-down');
    case 'site-url':
      return troubleshootCall('links-show-localhost');
    case 'wallets':
      return troubleshootCall('payment-create-code-5');
    case 'api-key':
      return troubleshootCall('api-unauthorized');
    case 'version':
      return { tool: 'payram_runbook', arguments: { task: 'upgrade' } };
    default:
      return null;
  }
};

export interface DoctorOptions {
  /** Only reachability, health and the optional key probe (used by test_payram_connection). */
  connectivityOnly?: boolean;
}

type HealthBody = {
  status?: string;
  db?: string;
  version?: string;
  workers?: Record<string, string>;
};

export const runDoctor = async (args: Input, opts: DoctorOptions = {}): Promise<Output> => {
  const findings: Output['findings'] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];
  let baseUrl: string | null = null;
  let version: string | null = null;
  let latestVersion: string | null = null;
  const out = (partial: Partial<Output> = {}): Output => ({
    baseUrl,
    healthy: false,
    failedStage: null,
    version,
    latestVersion,
    findings,
    warnings,
    likelyCauses: [],
    nextSteps,
    setupStage: null,
    nextCall: null,
    ...partial,
  });
  const fail = (failedStage: string, likelyCauses: Cause[], extra: Partial<Output> = {}) =>
    out({ failedStage, likelyCauses, ...extra });

  const rawBase = args.baseUrl ?? getOptionalPayramBaseUrl();
  if (!rawBase) {
    return fail('input', [
      {
        likelihood: '100%',
        cause: 'No server address given',
        fix: 'Call payram_doctor with baseUrl set to the dashboard address, e.g. {"baseUrl":"pay.example.com"}',
      },
    ]);
  }
  let candidates: URL[];
  try {
    const parsed = baseCandidates(rawBase);
    candidates = parsed.urls;
    if (parsed.note) warnings.push(parsed.note);
  } catch (error) {
    return fail('input', [
      {
        likelihood: '100%',
        cause: (error as Error).message,
        fix: 'Pass the dashboard address, e.g. https://pay.example.com or pay.example.com',
      },
    ]);
  }
  // Independent of the server: start it now, await it after health.
  const latestP = opts.connectivityOnly ? null : getLatestCoreVersion();

  // ── reachability + health (public) ─────────────────────────────────
  // A bare host is tried over https and http together; prefer a PayRam answer, then any answer.
  const attempts = await Promise.allSettled(
    candidates.map((c) => safeFetch(`${c.href.replace(/\/+$/, '')}/api/v1/health`)),
  );
  const parseHealth = (body: string): HealthBody | null => {
    try {
      const parsed = JSON.parse(body) as HealthBody;
      return parsed && typeof parsed === 'object' && 'status' in parsed ? parsed : null;
    } catch {
      return null;
    }
  };
  const answered = (i: number) => attempts[i].status === 'fulfilled';
  const isPayram = (i: number) =>
    answered(i) &&
    parseHealth((attempts[i] as PromiseFulfilledResult<SafeFetchResult>).value.body) !== null;
  const chosen =
    candidates.findIndex((_, i) => isPayram(i)) >= 0
      ? candidates.findIndex((_, i) => isPayram(i))
      : Math.max(
          candidates.findIndex((_, i) => answered(i)),
          0,
        );
  const base = candidates[chosen];
  baseUrl = base.href.replace(/\/+$/, '');
  const checkingLocally = isLoopbackHost(base.hostname);
  if (base.port === '8080' || base.port === '8443') {
    warnings.push(
      `Port ${base.port} is a legacy port. Current installs serve everything on 80/443; use the dashboard URL without a port.`,
    );
  }
  const attempt = attempts[chosen];

  if (attempt.status === 'rejected') {
    const error = attempt.reason;
    const message = error instanceof Error ? error.message : String(error);
    findings.push({ check: 'reachability', ok: false, detail: excerpt(message, 160) });
    const kind = classifyFailure(error);
    const probed = new Map<number, PortState>();
    if (kind !== 'private' && kind !== 'dns' && kind !== 'tls' && kind !== 'wrong-protocol') {
      const ports = [...new Set([80, 443, 8080, 8443, ...(base.port ? [Number(base.port)] : [])])];
      const states = await Promise.all(ports.map((p) => probePort(base.hostname, p)));
      ports.forEach((p, i) => probed.set(p, states[i]));
      findings.push({
        check: 'ports',
        ok: states.includes('open'),
        detail: portsSummary(probed),
      });
    }
    const { causes, troubleshootId } = networkCauses(base, kind, probed);
    return fail(kind === 'private' ? 'input' : 'reachability', causes, {
      nextCall: troubleshootId
        ? { tool: 'payram_troubleshoot', arguments: { id: troubleshootId } }
        : null,
    });
  }

  const res = attempt.value;
  if (res.tls) {
    const days = res.tls.daysRemaining;
    findings.push({
      check: 'tls',
      ok: res.tls.authorized && (days ?? 99) > 0,
      detail: `certificate valid until ${res.tls.validTo ?? 'unknown'}${days !== undefined ? ` (${days} days)` : ''}`,
    });
    if (days !== undefined && days < 21)
      warnings.push(
        `TLS certificate expires in ${days} days. If Let's Encrypt renewal is failing: payram_runbook "ssl_renewal_fix".`,
      );
  } else if (!checkingLocally) {
    warnings.push(
      'No HTTPS. Fine for a first test; use HTTPS before taking real payments (payram_runbook "ssl_setup").',
    );
  }
  if (res.redirects.some((r) => r.startsWith('blocked'))) {
    warnings.push(
      `The server redirects to another host (${res.redirects.join(', ')}); check the URL you use.`,
    );
  }
  const parsedHealth = parseHealth(res.body);
  if (!parsedHealth) {
    findings.push({
      check: 'reachability',
      ok: false,
      detail: `GET /api/v1/health → HTTP ${res.status}, not a PayRam health response (${excerpt(res.body, 80)})`,
    });
    const { causes, troubleshootId } = notPayramCauses(res);
    return fail('reachability', causes, {
      nextCall: troubleshootId
        ? { tool: 'payram_troubleshoot', arguments: { id: troubleshootId } }
        : null,
    });
  }
  const health = parsedHealth;
  findings.push({
    check: 'reachability',
    ok: true,
    detail: `${baseUrl} answers (HTTP ${res.status})`,
  });

  // health.status reflects the database only; workers are checked separately below.
  const statusOk = health.status === 'ok';
  findings.push({
    check: 'health',
    ok: statusOk,
    detail: `status=${health.status ?? '?'} db=${health.db ?? '?'}`,
  });

  // ── workers (from public health) ───────────────────────────────────
  if (health.workers) {
    const programs = Object.entries(health.workers);
    const down = programs.filter(([name, state]) => isProgramDown(name, state));
    findings.push({
      check: 'workers',
      ok: down.length === 0,
      detail: down.length
        ? `not running: ${down.map(([n, s]) => `${n}=${s}`).join(', ')}`
        : `${programs.length} programs up`,
    });
    if (down.length)
      nextSteps.push(
        'Inspect and restart: payram_ops_playbook "workers" then "restart_worker" (with the human\'s OK).',
      );
  }

  // ── version ────────────────────────────────────────────────────────
  version = health.version ?? null;
  if (latestP) {
    latestVersion = await latestP;
    const cmp = version ? compareVersions(version, latestVersion) : null;
    if (version && cmp === null) {
      findings.push({
        check: 'version',
        ok: true,
        detail: `build reports "${version}" (no version tag); latest release is ${latestVersion}`,
      });
      warnings.push(
        `Cannot compare versions: the server reports "${version}". Check the image tag on the server: docker inspect ${CONTAINER.name} --format '{{.Config.Image}}'.`,
      );
    } else if (cmp !== null) {
      findings.push({
        check: 'version',
        ok: cmp >= 0,
        detail: `installed ${version}, latest ${latestVersion}`,
      });
      if (cmp < 0)
        nextSteps.push('An update is available: payram_runbook "upgrade" (human decision).');
    }
  }

  // ── optional probes, run together once the server is known to be PayRam ──
  const apiKey = args.apiKey ?? getOptionalPayramApiKey();
  const admin = !opts.connectivityOnly && Boolean(getOptionalPayramAccessToken());
  const [keyProbe, siteProbe, walletProbe] = await Promise.allSettled([
    apiKey
      ? safeFetch(`${baseUrl}/api/v1/payment`, {
          method: 'POST',
          headers: { 'API-Key': apiKey, 'Content-Type': 'application/json' },
          body: '{}', // invalid on purpose: 400 = key accepted, nothing is created
        })
      : null,
    admin ? getSiteUrl() : null,
    admin ? getWallets() : null,
  ]);

  if (!apiKey) {
    nextSteps.push(
      'To validate an API key without sharing it, run payram_ops_playbook "connect" locally.',
    );
  } else if (keyProbe.status === 'rejected') {
    logger.warn('doctor: api-key probe failed', { error: (keyProbe.reason as Error).message });
  } else if (keyProbe.value) {
    const status = keyProbe.value.status;
    const accepted = status !== 401 && status !== 403;
    findings.push({
      check: 'api-key',
      ok: accepted,
      detail: accepted
        ? `key accepted (validation probe returned HTTP ${status}; nothing was created)`
        : `key rejected (HTTP ${status})`,
    });
    if (!accepted) {
      return fail(
        'api-key',
        [
          {
            likelihood: '60%',
            cause: 'The key is wrong, deactivated or from another PayRam server',
            fix: `Re-mint on the server: ${INSTALL.agentCmd('ensure-api-key')}`,
          },
          {
            likelihood: '40%',
            cause: 'A dashboard login token (JWT) was used instead of the project API key',
            fix: 'Use the key from ~/.payraminfo/merchant-api-key.env or Project → API keys (header API-Key)',
          },
        ],
        { setupStage: 'installed', nextCall: troubleshootCall('api-unauthorized') },
      );
    }
  }

  // ── local-mode admin checks (JWT from this server's env) ───────────
  if (admin) {
    if (siteProbe.status === 'fulfilled') {
      const siteUrl = (siteProbe.value as { siteUrl?: string | null } | null)?.siteUrl ?? null;
      let siteOrigin: string | null = null;
      try {
        siteOrigin = siteUrl ? new URL(siteUrl).origin : null;
      } catch {
        siteOrigin = null;
      }
      // From a loopback check we cannot know the public origin; otherwise it must match.
      const ok = siteOrigin !== null && (checkingLocally || siteOrigin === base.origin);
      findings.push({
        check: 'site-url',
        ok,
        detail: siteUrl
          ? `site URL ${siteUrl}${ok ? '' : ` (expected ${base.origin})`}`
          : 'site URL is not set (payment creation fails until it is)',
      });
      if (!ok) nextSteps.push('Fix the public site URL: payram_runbook "set_site_url".');
    } else {
      findings.push({
        check: 'site-url',
        ok: false,
        detail: excerpt((siteProbe.reason as Error).message, 120),
      });
    }
    if (walletProbe.status === 'fulfilled') {
      const wallets = (walletProbe.value ?? []) as Awaited<ReturnType<typeof getWallets>>;
      const deposit = wallets.filter(
        (w) => (w.walletType ?? '').toLowerCase() === 'deposit_wallet',
      );
      findings.push({
        check: 'wallets',
        ok: deposit.length > 0,
        detail: `${deposit.length} deposit wallet(s)`,
      });
      if (!deposit.length)
        nextSteps.push(
          `No deposit wallet yet: PAYRAM_BLOCKCHAIN_CODE=BASE ${INSTALL.agentCmd('deploy-scw-flow')} (USDC on Base) or ${INSTALL.agentCmd('ensure-wallet')} (BTC).`,
        );
    } else {
      findings.push({
        check: 'wallets',
        ok: false,
        detail: excerpt((walletProbe.reason as Error).message, 120),
      });
    }
  } else if (!opts.connectivityOnly) {
    nextSteps.push(
      'For site URL, wallets, sweeps and payments run payram_ops_playbook "daily_check" with your own credentials.',
    );
  }

  if (!statusOk) {
    return fail(
      'health',
      [
        {
          likelihood: '60%',
          cause: `Server reports ${health.status}${health.db && health.db !== 'ok' ? ` (database: ${health.db})` : ''}`,
          fix: 'payram_ops_playbook "logs" on the server; then "workers"',
        },
        {
          likelihood: '40%',
          cause: 'A worker or the database is down after a restart/upgrade',
          fix: `${CONTAINER.supervisorctl}; ${INSTALL.restart}`,
        },
      ],
      { setupStage: 'installed', nextCall: troubleshootCall('worker-down') },
    );
  }
  const failed = findings.find((f) => !f.ok);
  const domain = net.isIP(base.hostname) ? undefined : base.hostname;
  return out({
    healthy: !failed,
    failedStage: failed?.check ?? null,
    setupStage: 'installed',
    nextCall: failed
      ? nextCallForFailedCheck(failed.check)
      : {
          tool: 'payram_setup_plan',
          arguments: { stage: 'installed', ...(domain ? { domain } : {}) },
        },
  });
};

export const registerDoctorTool = (server: McpServer) => {
  server.registerTool(
    'payram_doctor',
    {
      title: 'Diagnose a PayRam server',
      description:
        'Read-only diagnosis of a PayRam server by its public URL — works from the hosted MCP without credentials: reachability, health, TLS certificate, installed vs latest version, worker states. Optionally validates an API key without creating anything. Returns ranked likely causes and exact fixes for the first failing stage. Run this first when anything PayRam-related fails.',
      inputSchema,
      outputSchema,
    },
    safeHandler(
      async (args: Input) => {
        const result = await runDoctor(args);
        return { content: [textContent(render(result))], structuredContent: result };
      },
      { toolName: 'payram_doctor' },
    ),
  );
};
