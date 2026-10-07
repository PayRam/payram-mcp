import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { restartWorker, restartAllWorkers } from '../../api/payramApi.js';

/**
 * Accepts either a worker name ('base-listener') or a bare chain code
 * ('BASE') and normalizes to core's `<lower-chain>-listener` convention.
 * Names containing a dash are assumed to already be worker names.
 */
const normalizeWorkerName = (input: string): string => {
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes('-') ? trimmed : `${trimmed}-listener`;
};

const inputSchema = z
  .object({
    worker: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Worker to restart: a chain code ('BASE', 'ETH', 'BTC', 'TRX', 'POLYGON' → restarts that chain's listener) or a full worker name ('base-listener'). Omit when using all=true.",
      ),
    all: z
      .boolean()
      .optional()
      .describe('Restart ALL workers. Use only when multiple chains are unhealthy.'),
  })
  .strict();

const schemas = buildToolSchemas({
  input: inputSchema,
  output: z.object({
    restarted: z.string(),
    message: z.string(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

export const registerRestartWorkerTool = (server: McpServer) => {
  server.registerTool(
    'restart_payram_worker',
    {
      title: 'Restart PayRam Worker',
      description:
        'REMEDIATION ACTION (write): restarts a blockchain listener worker via supervisor — the ' +
        'minimal fix when check_node_sync reports a chain as lagging or listener-down. ' +
        'Workflow: run check_node_sync first → restart the named worker → wait ~60s → run ' +
        'check_node_sync again to confirm recovery. A restart does NOT fix an unreachable RPC ' +
        '(fix the RPC config in the dashboard instead). Requires admin JWT with write_system_settings.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof inputSchema>) => {
        if (!params.all && !params.worker) {
          throw new Error("Provide 'worker' (chain code or worker name) or set all=true.");
        }

        let restarted: string;
        let result: { message?: string };
        if (params.all) {
          result = await restartAllWorkers();
          restarted = 'all workers';
        } else {
          restarted = normalizeWorkerName(params.worker!);
          result = await restartWorker(restarted);
        }

        const message =
          `Restarted: ${restarted}. ${result.message ?? ''}`.trim() +
          '\nWait ~60s, then run check_node_sync to confirm the chain recovered ' +
          '(block age should drop below its threshold).';

        logger.info('Worker restarted', { restarted });

        return {
          content: [textContent(message)],
          structuredContent: { restarted, message: result.message ?? 'ok' },
        };
      },
      { toolName: 'restart_payram_worker' },
    ),
  );
};
