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
import { excerpt, parseBaseUrl, safeFetch, UnsafeUrlError } from '../utils/safeFetch.js';
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
      'Public URL of the PayRam server, same origin as the dashboard (e.g. https://pay.example.com). No :8080. Required on the hosted MCP.',
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
  return lines.join('\n');
};

const networkCauses = (base: URL, message: string): Cause[] => {
  const causes: Cause[] = [];
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    causes.push({
      likelihood: '70%',
      cause: `DNS for ${base.hostname} does not resolve`,
      fix: `Create/fix the A record: dig +short ${base.hostname}`,
    });
  }
  if (/CERT|SSL|TLS|self.signed|unable to verify/i.test(message)) {
    causes.push({
      likelihood: '70%',
      cause: 'The TLS certificate is invalid or expired',
      fix: 'payram_runbook "ssl_setup" / "ssl_renewal_fix"',
    });
  }
  if (/private or reserved/i.test(message)) {
    return [
      {
        likelihood: '100%',
        cause: 'The URL is a private/internal address; the hosted MCP only checks public servers',
        fix: 'Use the public URL, or run the check on the server: curl -s http://localhost/api/v1/health (payram_ops_playbook "health")',
      },
    ];
  }
  causes.push(
    {
      likelihood: '50%',
      cause: 'The PayRam container is not running',
      fix: `On the server: docker ps --filter name=${CONTAINER.name}; restart: ${INSTALL.restart}`,
    },
    {
      likelihood: '30%',
      cause:
        'Port 80/443 blocked by a firewall, or the wrong port in the URL (PayRam serves on 80/443, not 8080)',
      fix: `On the server: docker port ${CONTAINER.name}; open 80/443 in the cloud firewall`,
    },
  );
  return causes;
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
    ...partial,
  });
  const fail = (failedStage: string, likelyCauses: Cause[]) => out({ failedStage, likelyCauses });

  const rawBase = args.baseUrl ?? getOptionalPayramBaseUrl();
  if (!rawBase) {
    return fail('input', [
      {
        likelihood: '100%',
        cause: 'No server URL given',
        fix: 'Call payram_doctor with baseUrl set to the dashboard URL, e.g. {"baseUrl":"https://pay.example.com"}',
      },
    ]);
  }
  let base: URL;
  try {
    base = parseBaseUrl(rawBase);
  } catch (error) {
    return fail('input', [
      {
        likelihood: '100%',
        cause: (error as Error).message,
        fix: 'Pass the dashboard URL, e.g. https://pay.example.com',
      },
    ]);
  }
  baseUrl = base.href.replace(/\/+$/, '');
  const checkingLocally = isLoopbackHost(base.hostname);
  if (base.port === '8080' || base.port === '8443') {
    warnings.push(
      `Port ${base.port} is a legacy port. Current installs serve everything on 80/443; use the dashboard URL without a port.`,
    );
  }
  // Independent of the server: start it now, await it after health.
  const latestP = opts.connectivityOnly ? null : getLatestCoreVersion();

  // ── reachability + health (public) ─────────────────────────────────
  let health: HealthBody | null;
  try {
    const res = await safeFetch(`${baseUrl}/api/v1/health`);
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
    try {
      health = JSON.parse(res.body) as HealthBody;
    } catch {
      health = null;
    }
    if (!health || typeof health !== 'object' || !('status' in health)) {
      findings.push({
        check: 'reachability',
        ok: false,
        detail: `GET /api/v1/health → HTTP ${res.status}, not a PayRam health response (${excerpt(res.body, 80)})`,
      });
      return fail('reachability', [
        {
          likelihood: '50%',
          cause:
            'The URL points at something other than PayRam (another site, a proxy page, or an old install without /api/v1/health)',
          fix: 'Use the exact dashboard URL; on the server check: curl -s http://localhost/api/v1/health',
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
      ]);
    }
    findings.push({
      check: 'reachability',
      ok: true,
      detail: `${baseUrl} answers (HTTP ${res.status})`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings.push({ check: 'reachability', ok: false, detail: excerpt(message, 160) });
    return fail(
      error instanceof UnsafeUrlError ? 'input' : 'reachability',
      networkCauses(base, message),
    );
  }

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
      return fail('api-key', [
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
      ]);
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
    return fail('health', [
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
    ]);
  }
  const failed = findings.find((f) => !f.ok);
  return out({ healthy: !failed, failedStage: failed?.check ?? null });
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
