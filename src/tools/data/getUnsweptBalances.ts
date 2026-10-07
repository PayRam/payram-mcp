import { SWEEP_GAS_STATUSES } from '../../facts/payram.js';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { getAddressBalances } from '../../api/payramApi.js';
import type { AddressBalanceEntry } from '../../api/types.js';

const sweepErrorSchema = z
  .object({
    statusCode: z.string(), // e.g. LOW_NATIVE_BALANCE, HOT_WALLET_MISSING
    category: z.string(),
    reason: z.string(),
    actionHint: z.string().optional(),
    retryable: z.boolean(),
    occurredAt: z.string(),
    address: z.string(),
    txHash: z.string().optional(),
    hotWalletAddress: z.string().optional(),
  })
  .passthrough();

const balanceEntrySchema = z
  .object({
    walletName: z.string(),
    walletID: z.number(),
    blockchainCode: z.string(),
    blockchainFamily: z.string(),
    currencyCode: z.string(),
    amount: z.string(),
    amountUSD: z.string().optional(),
    addressCount: z.number(),
    action: z.string(),
    // Sweep diagnostics — the "why isn't this moving" fields.
    walletActive: z.boolean().optional(),
    hotWalletAddress: z.string().optional(),
    hotWalletActive: z.boolean().optional(),
    coldWalletConfigured: z.boolean().optional(),
    isSCWDeploymentPending: z.boolean().optional(),
    nextProbableSweepAt: z.string().optional(),
    sweepInProgressTxHash: z.string().optional(),
    lastSweepError: sweepErrorSchema.optional(),
  })
  .passthrough();

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: z.object({
    balances: z.array(balanceEntrySchema),
    totalWallets: z.number(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

const formatEntry = (e: AddressBalanceEntry): string => {
  const amount = parseFloat(e.amount) || 0;
  const amountStr = amount.toFixed(6);
  const usd = e.amountUSD ? ` (~$${parseFloat(e.amountUSD).toFixed(2)})` : '';
  return (
    `  ${e.walletName.padEnd(24)} ${e.blockchainCode.padEnd(10)} ` +
    `${e.currencyCode.padEnd(8)} ${amountStr.padStart(16)}${usd} ` +
    `${String(e.addressCount).padStart(6)} addrs   ${e.action}`
  );
};

/** One line per stuck entry explaining WHY and what to do about it. */
const diagnoseEntry = (e: AddressBalanceEntry): string | null => {
  if (e.lastSweepError) {
    const err = e.lastSweepError;
    // Core nests the address to top up inside lastSweepError for gas failures.
    const topUp = err.hotWalletAddress ?? e.hotWalletAddress;
    const gas =
      SWEEP_GAS_STATUSES.includes(err.statusCode) && topUp
        ? ` — the human needs to send native gas to the hot wallet: ${topUp}`
        : '';
    const hint = err.actionHint ? ` ${err.actionHint}` : '';
    return `${e.blockchainCode}/${e.currencyCode}: last sweep failed [${err.statusCode}] ${err.reason}.${hint}${gas}${err.retryable ? ' (retryable — will be retried automatically)' : ''}`;
  }
  if (e.action === 'sweep_not_allowed') {
    if (e.isSCWDeploymentPending)
      return `${e.blockchainCode}/${e.currencyCode}: SCW deployment still pending — funds sweep once the contract is deployed (deploy-scw-flow).`;
    if (e.coldWalletConfigured === false)
      return `${e.blockchainCode}/${e.currencyCode}: no cold wallet configured — set the fund-collector/cold wallet to enable sweeping.`;
    if (e.walletActive === false)
      return `${e.blockchainCode}/${e.currencyCode}: wallet is inactive — re-activate it in the dashboard.`;
  }
  return null;
};

export const registerGetUnsweptBalancesTool = (server: McpServer) => {
  server.registerTool(
    'get_unswept_balances',
    {
      title: 'Get Unswept Balances',
      description:
        'Returns unswept (unsettled) balances across all wallets, broken down by blockchain and currency. ' +
        'Shows sweep readiness per entry (sweep, sweep_in_progress, sweep_not_allowed, no_balance) AND why ' +
        'stuck funds are stuck: lastSweepError (e.g. LOW_NATIVE_BALANCE with the hot-wallet address to fund), ' +
        'pending SCW deployment, or missing cold wallet. Use this to answer "where is my money / why has it not swept".',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        const allBalances = await getAddressBalances();

        // Filter out zero-balance entries
        const balances = allBalances.filter((e) => {
          const amount = parseFloat(e.amount);
          return amount > 0;
        });

        const walletIds = new Set(balances.map((e) => e.walletID));

        let message: string;
        if (balances.length === 0) {
          message = 'No unswept balances found. All addresses have zero balance.';
        } else {
          const header =
            `Unswept Balances (${balances.length} entries across ${walletIds.size} wallet(s)):\n\n` +
            `  ${'Wallet'.padEnd(24)} ${'Chain'.padEnd(10)} ${'Currency'.padEnd(8)} ${'Amount'.padStart(16)} ${'Addrs'.padStart(6)}         Action`;
          const separator = `  ${'─'.repeat(90)}`;
          const rows = balances.map(formatEntry).join('\n');
          message = `${header}\n${separator}\n${rows}`;

          const diagnoses = balances.map(diagnoseEntry).filter((d): d is string => d !== null);
          if (diagnoses.length) {
            message += `\n\nWhy funds aren't moving:\n${diagnoses.map((d) => `  • ${d}`).join('\n')}`;
          }
        }

        logger.info('Unswept balances fetched', {
          totalEntries: balances.length,
          wallets: walletIds.size,
        });

        return {
          content: [textContent(message)],
          structuredContent: {
            balances: balances.map((b) => ({ ...b })),
            totalWallets: walletIds.size,
          },
        };
      },
      { toolName: 'get_unswept_balances' },
    ),
  );
};
