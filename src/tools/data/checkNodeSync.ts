import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { CONTAINER, RESTARTABLE_WORKERS, isProgramDown } from '../../facts/payram.js';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { getWorkersStatus, getBlockchains, testBlockchainConnection } from '../../api/payramApi.js';
import type { NodeHealth, WorkerStatus } from '../../api/types.js';

/**
 * Per-chain staleness thresholds. BTC mines a block every ~10 minutes, so a
 * 10-minute threshold would false-alarm constantly — 90 minutes (~9 missed
 * blocks) means genuinely stuck. Every other supported chain produces blocks
 * in seconds, so a block older than 10 minutes means the node is lagging or
 * not syncing.
 */
const STALE_SECONDS_DEFAULT = 600; // 10 minutes
const STALE_SECONDS_BTC = 5400; // 90 minutes
const staleThresholdSeconds = (chainCode: string): number =>
  chainCode.toUpperCase() === 'BTC' ? STALE_SECONDS_BTC : STALE_SECONDS_DEFAULT;

/** Listener worker name convention in payram-core: `<lower-chain>-listener`. */
const listenerWorkerFor = (chainCode: string): string => `${chainCode.toLowerCase()}-listener`;

const nodeReportSchema = z
  .object({
    url: z.string(),
    connected: z.boolean(),
    lastBlockSeen: z.number().optional(),
    blockAgeSeconds: z.number().nullable().optional(),
    stale: z.boolean(),
    avgLatencyMs: z.number().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const chainReportSchema = z.object({
  blockchainCode: z.string(),
  verdict: z.enum(['healthy', 'lagging', 'unreachable', 'listener-down']),
  staleThresholdSeconds: z.number(),
  listenerWorker: z.string(),
  listenerRunning: z.boolean(),
  reachable: z.boolean(),
  oldestBlockAgeSeconds: z.number().nullable(),
  nodes: z.array(nodeReportSchema),
  note: z.string().optional(),
});

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: z.object({
    workers: z.array(
      z.object({ name: z.string(), status: z.string(), details: z.string() }).passthrough(),
    ),
    chains: z.array(chainReportSchema),
    issues: z.array(z.string()),
    healthy: z.boolean(),
    workersAvailable: z.boolean(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

const blockAgeSeconds = (n: NodeHealth): number | null => {
  if (!n.lastBlockTimestamp) return null;
  const ts = Date.parse(n.lastBlockTimestamp);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
};

const fmtAge = (s: number | null | undefined): string => {
  if (s === null || s === undefined) return '—';
  if (s < 90) return `${s}s`;
  return `${Math.round(s / 60)}m`;
};

export const registerCheckNodeSyncTool = (server: McpServer) => {
  server.registerTool(
    'check_node_sync',
    {
      title: 'Check Node Sync',
      description:
        'Per-chain node health verdict: healthy / lagging / unreachable / listener-down. ' +
        'Computes how old each RPC node’s last block is — any non-BTC chain older than 10 minutes ' +
        '(BTC: 90 minutes, since BTC blocks every ~10m) is flagged as lagging or not syncing. ' +
        'Also checks the chain’s listener worker. When something is wrong it names the exact ' +
        'remediation (usually restart_payram_worker). Read-only — run this first; restart second; ' +
        're-run this ~60s after a restart to confirm recovery.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        // Blockchains are required; worker status is best-effort — a host with
        // no supervisord returns 500 there, and we must NOT let that (a) fail
        // the whole tool or (b) falsely mark every listener down.
        const [workersResult, blockchains] = await Promise.all([
          getWorkersStatus().then(
            (w) => ({ ok: true as const, workers: w }),
            () => ({ ok: false as const, workers: [] as WorkerStatus[] }),
          ),
          getBlockchains(),
        ]);
        const workers = workersResult.workers;
        const workersAvailable = workersResult.ok;

        const activeChains = blockchains.filter(
          (b) => (b.status ?? 'active').toLowerCase() === 'active',
        );

        const runningWorkers = new Set(
          workers
            .filter((w) => w.status.toUpperCase() === 'RUNNING')
            .map((w) => w.name.toLowerCase()),
        );

        const chains = await Promise.all(
          activeChains.map(async (chain) => {
            const threshold = staleThresholdSeconds(chain.code);
            const worker = listenerWorkerFor(chain.code);
            const listenerRunning = runningWorkers.has(worker);
            try {
              const result = await testBlockchainConnection(chain.code);
              const nodes = result.nodes.map((n) => {
                const age = blockAgeSeconds(n);
                return {
                  url: n.url,
                  connected: n.connected,
                  lastBlockSeen: n.lastBlockSeen,
                  blockAgeSeconds: age,
                  stale: age !== null && age > threshold,
                  avgLatencyMs: n.avgLatencyMs,
                  error: n.error,
                };
              });
              const ages = nodes
                .map((n) => n.blockAgeSeconds)
                .filter((a): a is number => a !== null && a !== undefined);
              const oldestAge = ages.length ? Math.max(...ages) : null;
              const anyConnected = nodes.some((n) => n.connected);
              const anyStale = nodes.some((n) => n.stale);

              let verdict: 'healthy' | 'lagging' | 'unreachable' | 'listener-down';
              if (!result.success || !anyConnected) verdict = 'unreachable';
              // Only trust listener state when worker status was actually
              // available — otherwise a supervisorctl-less host would read as
              // every-listener-down.
              else if (workersAvailable && !listenerRunning) verdict = 'listener-down';
              else if (anyStale) verdict = 'lagging';
              else verdict = 'healthy';

              return {
                blockchainCode: chain.code,
                verdict,
                staleThresholdSeconds: threshold,
                listenerWorker: worker,
                listenerRunning,
                reachable: result.success,
                oldestBlockAgeSeconds: oldestAge,
                nodes,
              };
            } catch (error) {
              return {
                blockchainCode: chain.code,
                verdict: 'unreachable' as const,
                staleThresholdSeconds: threshold,
                listenerWorker: worker,
                listenerRunning,
                reachable: false,
                oldestBlockAgeSeconds: null,
                nodes: [],
                note: error instanceof Error ? error.message : 'test-connection failed',
              };
            }
          }),
        );

        // Issues with the exact next action — the agent's remediation list.
        const issues: string[] = [];
        for (const c of chains) {
          if (c.verdict === 'lagging') {
            issues.push(
              `${c.blockchainCode}: last block is ${fmtAge(c.oldestBlockAgeSeconds)} old ` +
                `(threshold ${Math.round(c.staleThresholdSeconds / 60)}m) — node may be lagging or not syncing. ` +
                `Remediation: restart_payram_worker {"worker": "${c.listenerWorker}"}, then re-run check_node_sync after ~60s.`,
            );
          } else if (c.verdict === 'listener-down') {
            issues.push(
              `${c.blockchainCode}: listener worker '${c.listenerWorker}' is not running — deposits on this chain are NOT being detected. ` +
                `Remediation: restart_payram_worker {"worker": "${c.listenerWorker}"}.`,
            );
          } else if (c.verdict === 'unreachable') {
            issues.push(
              `${c.blockchainCode}: no RPC node reachable${c.note ? ` (${c.note})` : ''} — check the chain's RPC configuration in the dashboard ` +
                `(a worker restart won't fix an unreachable RPC).`,
            );
          }
        }
        const orphanWorkersDown = workers.filter(
          (w) =>
            isProgramDown(w.name, w.status) &&
            !chains.some((c) => c.listenerWorker === w.name.toLowerCase()),
        );
        for (const w of orphanWorkersDown) {
          const restartable = (RESTARTABLE_WORKERS as readonly string[]).includes(w.name);
          issues.push(
            restartable
              ? `worker '${w.name}' is ${w.status} — Remediation: restart_payram_worker {"worker": "${w.name}"}.`
              : `'${w.name}' is ${w.status} — not restartable via the API; on the server: ${CONTAINER.supervisorctl} and \`docker exec ${CONTAINER.name} supervisorctl restart ${w.name}\` (with the human's OK).`,
          );
        }

        const healthy = issues.length === 0;

        const listenerLabel = (running: boolean) =>
          !workersAvailable ? 'unknown' : running ? 'up' : 'DOWN';
        const chainLines = chains
          .map((c) => {
            const flag = c.verdict === 'healthy' ? '✓' : c.verdict === 'lagging' ? '⚠' : '✗';
            const age = fmtAge(c.oldestBlockAgeSeconds);
            return `  ${flag} ${c.blockchainCode.padEnd(10)} ${c.verdict.padEnd(14)} last block ${age} ago (threshold ${Math.round(c.staleThresholdSeconds / 60)}m) listener:${listenerLabel(c.listenerRunning)}`;
          })
          .join('\n');

        const issueLines = issues.map((i) => `  • ${i}`).join('\n');
        const workersNote = workersAvailable
          ? ''
          : '\n\nNote: worker status is unavailable on this host (no supervisord, or the ' +
            'system endpoint returned an error) — listener state is shown as "unknown" and ' +
            'listener-down issues are suppressed. Block-age/RPC checks above are still valid.';

        const message =
          `Node sync: ${healthy ? 'HEALTHY ✓' : `${issues.length} ISSUE(S) ⚠`}\n\n` +
          `${chainLines || '  (no active chains)'}` +
          (issues.length ? `\n\nIssues + remediation:\n${issueLines}` : '') +
          workersNote;

        logger.info('Node sync checked', { issues: issues.length, healthy, workersAvailable });

        return {
          content: [textContent(message)],
          structuredContent: {
            workers: workers.map((w) => ({ ...w })),
            chains,
            issues,
            healthy,
            workersAvailable,
          },
        };
      },
      { toolName: 'check_node_sync' },
    ),
  );
};
