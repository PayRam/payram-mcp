import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { searchPayments } from '../../api/payramApi.js';
import { resolveExternalPlatformId } from './index.js';
import type { PaymentData } from '../../api/types.js';

const schemas = buildToolSchemas({
  input: z
    .object({
      externalPlatformId: z
        .string()
        .optional()
        .describe('Optional. Auto-discovered from your account if omitted.'),
      query: z
        .string()
        .optional()
        .describe('Free-text search: tx hash, email, reference ID, customer ID, or invoice ID.'),
      paymentStatus: z
        // The filter matches core's COMPUTED payment_status column, which is
        // uppercase and case-sensitive in SQL. 'FILLED' = completed.
        .array(
          z.enum([
            'OPEN',
            'FILLED',
            'PARTIALLY_FILLED',
            'OVER_FILLED',
            'CANCELLED',
            'CONFIRMING',
            'DEPOSIT_RECEIVED',
            'UNDEFINED',
          ]),
        )
        .optional()
        .describe('Filter by payment status (FILLED = completed).'),
      network: z
        .array(z.string())
        .optional()
        .describe('Filter by blockchain network (e.g. BTC, ETH, TRX, BASE, POLYGON).'),
      currency: z
        .array(z.string())
        .optional()
        .describe('Filter by currency code (e.g. USDC, USDT, BTC, ETH, TRX, CBBTC).'),
      webhookStatus: z
        .array(z.enum(['received', 'pending', 'failed', 'waiting_for_approval', 'discarded']))
        .optional()
        .describe('Filter by webhook delivery status.'),
      createdBy: z
        .array(z.enum(['user', 'system']))
        .optional()
        .describe('Filter by creator type.'),
      dateFrom: z
        .string()
        .optional()
        .describe('Start date filter (ISO 8601, e.g. 2024-01-01T00:00:00Z).'),
      dateTo: z
        .string()
        .optional()
        .describe('End date filter (ISO 8601, e.g. 2024-12-31T23:59:59Z).'),
      sortBy: z
        .string()
        .optional()
        .describe(
          'Sort field. Valid: created_at, updated_at, payment_status, currency, network, ' +
            'block_id, from_address, to_address, invoice_id, reference_id, customer_id, email, created_by.',
        ),
      sortDirection: z
        .enum(['ASC', 'DESC'])
        .optional()
        .describe('Sort direction. Defaults to DESC.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Number of results per page. Defaults to 50.'),
      offset: z.number().int().min(0).optional().describe('Pagination offset. Defaults to 0.'),
    })
    .strict(),
  output: z.object({
    payments: z.array(z.record(z.string(), z.unknown())),
    totalCount: z.number(),
    showing: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

type Input = z.infer<typeof schemas.input>;

const textContent = (text: string) => ({ type: 'text' as const, text });

const formatRow = (p: PaymentData): string => {
  const status = p.paymentStatus.padEnd(16);
  const amount = p.amountInUSD != null ? `$${p.amountInUSD}` : '-';
  const filled = p.filledAmountInUSD != null ? `$${p.filledAmountInUSD}` : '-';
  const net = p.network ?? '-';
  const cur = p.currency ?? '-';
  const date = p.createdAt ? p.createdAt.slice(0, 10) : '-';
  return `  ${status} ${amount.padStart(12)} ${filled.padStart(12)} ${net.padEnd(8)} ${cur.padEnd(6)} ${date}`;
};

export const registerSearchPaymentsTool = (server: McpServer) => {
  server.registerTool(
    'search_payments',
    {
      title: 'Search Payments',
      description:
        'Search and filter payments with full control over status, network, currency, dates, ' +
        'webhook status, and pagination. Returns a paginated list of matching payments.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (args: Input) => {
        const platformId = await resolveExternalPlatformId(args.externalPlatformId);
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;

        const result = await searchPayments(platformId, {
          query: args.query,
          paymentStatus: args.paymentStatus,
          network: args.network,
          currency: args.currency,
          webhookStatus: args.webhookStatus,
          createdBy: args.createdBy,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          sortBy: args.sortBy ?? 'created_at',
          sortDirection: args.sortDirection ?? 'DESC',
          limit,
          offset,
        });

        const showing = result.data.length;
        const header =
          `Found ${result.totalCount} payment(s) (showing ${showing}, offset ${offset}):\n\n` +
          `  ${'Status'.padEnd(16)} ${'Amount'.padStart(12)} ${'Filled'.padStart(12)} ${'Network'.padEnd(8)} ${'Cur'.padEnd(6)} Date`;
        const separator = `  ${'─'.repeat(70)}`;
        const rows = result.data.map(formatRow).join('\n');

        const message =
          showing > 0
            ? `${header}\n${separator}\n${rows}`
            : 'No payments found matching the given filters.';

        logger.info('Payment search completed', { totalCount: result.totalCount, showing });

        return {
          content: [textContent(message)],
          structuredContent: {
            payments: result.data.map((p) => ({ ...p })),
            totalCount: result.totalCount,
            showing,
            limit,
            offset,
          },
        };
      },
      { toolName: 'search_payments' },
    ),
  );
};
