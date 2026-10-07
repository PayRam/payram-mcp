import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import {
  getBlockchains,
  getWallets,
  getWorkersStatus,
  getProjectBlockchainCurrency,
} from '../../api/payramApi.js';
import { resolveExternalPlatformId } from './index.js';
import type { WalletInfo, WorkerStatus } from '../../api/types.js';

const inputSchema = z
  .object({
    externalPlatformId: z
      .string()
      .optional()
      .describe('Project/platform ID to check currency enablement for (auto-resolved if omitted)'),
  })
  .strict();

const chainReadinessSchema = z.object({
  blockchainCode: z.string(),
  name: z.string(),
  family: z.string(),
  hasDepositWallet: z.boolean(),
  enabledForProject: z.boolean(),
  listenerRunning: z.boolean(),
  ready: z.boolean(),
  missing: z.array(z.string()),
});

const schemas = buildToolSchemas({
  input: inputSchema,
  output: z.object({
    projectId: z.string(),
    readyChains: z.array(z.string()),
    chains: z.array(chainReadinessSchema),
    allReady: z.boolean(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

/** A wallet that can receive deposits (anything but a gas-only wallet). */
const isDepositCapable = (w: WalletInfo): boolean =>
  (w.walletType ?? '').toLowerCase() !== 'gas_wallet';

const hasWalletForChain = (wallets: WalletInfo[], code: string, family: string): boolean =>
  wallets.some(
    (w) =>
      isDepositCapable(w) &&
      ((w.blockchainCode ?? '').toLowerCase() === code.toLowerCase() ||
        (w.family ?? '').toLowerCase() === family.toLowerCase()),
  );

const listenerRunningFor = (workers: WorkerStatus[], code: string, family: string): boolean =>
  workers.some((w) => {
    if (w.status.toUpperCase() !== 'RUNNING') return false;
    const name = w.name.toLowerCase();
    return name.includes(code.toLowerCase()) || name.includes(family.toLowerCase());
  });

export const registerCheckPaymentReadinessTool = (server: McpServer) => {
  server.registerTool(
    'check_payment_readiness',
    {
      title: 'Check Payment Readiness',
      description:
        'Diagnoses what is NOT yet set up to accept payments, per blockchain: missing deposit wallet, ' +
        'chain/currency not enabled for the project, or a stopped listener worker. Read-only — reports gaps ' +
        'and points to the CLI for wallet setup; it does not create wallets itself.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (args: z.infer<typeof inputSchema>) => {
        const projectId = await resolveExternalPlatformId(args.externalPlatformId);

        // Worker status is best-effort: a host with no supervisord returns 500
        // there. Don't let that fail the whole readiness check or falsely flag
        // every chain's listener as down.
        const [blockchains, wallets, workersResult, projectCurrencies] = await Promise.all([
          getBlockchains(),
          getWallets(),
          getWorkersStatus().then(
            (w) => ({ ok: true, workers: w }),
            () => ({ ok: false, workers: [] as WorkerStatus[] }),
          ),
          getProjectBlockchainCurrency(projectId),
        ]);
        const workers = workersResult.workers;
        const workersAvailable = workersResult.ok;

        const enabledChainCodes = new Set(
          Object.entries(projectCurrencies)
            .filter(([, currencies]) => Array.isArray(currencies) && currencies.length > 0)
            .map(([code]) => code.toLowerCase()),
        );

        const activeChains = blockchains.filter(
          (b) => (b.status ?? 'active').toLowerCase() === 'active',
        );

        const chains = activeChains.map((chain) => {
          const hasDepositWallet = hasWalletForChain(wallets, chain.code, chain.family);
          const enabledForProject = enabledChainCodes.has(chain.code.toLowerCase());
          const listenerRunning = listenerRunningFor(workers, chain.code, chain.family);

          const missing: string[] = [];
          if (!hasDepositWallet) {
            missing.push('no deposit wallet (run setup_payram_agents.sh deploy-scw-flow)');
          }
          if (!enabledForProject) {
            missing.push(
              'chain/currency not enabled for this project (dashboard → project settings)',
            );
          }
          // Only assert listener-down when worker status was actually
          // available — otherwise every chain would falsely read not-ready.
          if (workersAvailable && !listenerRunning) {
            missing.push('listener worker not running (check supervisorctl on the node)');
          }

          return {
            blockchainCode: chain.code,
            name: chain.name,
            family: chain.family,
            hasDepositWallet,
            enabledForProject,
            listenerRunning,
            ready: missing.length === 0,
            missing,
          };
        });

        const readyChains = chains.filter((c) => c.ready).map((c) => c.blockchainCode);
        const allReady = chains.length > 0 && readyChains.length === chains.length;

        const lines = chains
          .map((c) => {
            if (c.ready) return `  ✓ ${c.blockchainCode.padEnd(10)} ready`;
            return `  ✗ ${c.blockchainCode.padEnd(10)} ${c.missing.join('; ')}`;
          })
          .join('\n');

        const message =
          `Payment readiness for project ${projectId} ` +
          `(${readyChains.length}/${chains.length} chains ready):\n\n${lines || '  (no active chains configured)'}`;

        logger.info('Payment readiness checked', {
          projectId,
          ready: readyChains.length,
          total: chains.length,
        });

        return {
          content: [textContent(message)],
          structuredContent: { projectId, readyChains, chains, allReady },
        };
      },
      { toolName: 'check_payment_readiness' },
    ),
  );
};
