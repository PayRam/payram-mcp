import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { searchPayments } from '../../api/payramApi.js';
import { resolveExternalPlatformId } from './index.js';
import type { PaymentData } from '../../api/types.js';

const breakdownSchema = z.object({
  name: z.string(),
  count: z.number(),
  volumeUSD: z.number(),
});

const schemas = buildToolSchemas({
  input: z
    .object({
      date: z.string().optional().describe('Date in YYYY-MM-DD format. Defaults to today (UTC).'),
      externalPlatformId: z
        .string()
        .optional()
        .describe('Optional. Auto-discovered from your account if omitted.'),
    })
    .strict(),
  output: z.object({
    date: z.string(),
    totalPayments: z.number(),
    totalVolumeUSD: z.number(),
    byNetwork: z.array(breakdownSchema),
    byCurrency: z.array(breakdownSchema),
  }),
});

type Input = z.infer<typeof schemas.input>;

const textContent = (text: string) => ({ type: 'text' as const, text });
const PAGE_SIZE = 200;
const MAX_PAYMENTS = 10_000;

/**
 * Fetch all FILLED (completed) payments for a given date, paginating as needed.
 */
const fetchAllClosedPayments = async (
  platformId: string,
  dateFrom: string,
  dateTo: string,
): Promise<PaymentData[]> => {
  const allPayments: PaymentData[] = [];
  let offset = 0;

  while (offset < MAX_PAYMENTS) {
    const result = await searchPayments(platformId, {
      // Core's computed payment_status vocabulary is uppercase; the completed
      // state is FILLED ('closed' only exists on the raw status column).
      paymentStatus: ['FILLED'],
      dateFrom,
      dateTo,
      sortBy: 'created_at',
      sortDirection: 'DESC',
      limit: PAGE_SIZE,
      offset,
    });

    allPayments.push(...result.data);

    if (allPayments.length >= result.totalCount || result.data.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return allPayments;
};

interface Bucket {
  count: number;
  volumeUSD: number;
}

const aggregate = (
  payments: PaymentData[],
  keyFn: (p: PaymentData) => string | undefined,
): { name: string; count: number; volumeUSD: number }[] => {
  const map = new Map<string, Bucket>();

  for (const p of payments) {
    const key = keyFn(p) ?? 'unknown';
    const bucket = map.get(key) ?? { count: 0, volumeUSD: 0 };
    bucket.count += 1;
    bucket.volumeUSD += p.filledAmountInUSD ?? 0;
    map.set(key, bucket);
  }

  return Array.from(map.entries())
    .map(([name, b]) => ({ name, count: b.count, volumeUSD: Math.round(b.volumeUSD * 100) / 100 }))
    .sort((a, b) => b.volumeUSD - a.volumeUSD);
};

const formatBreakdown = (items: { name: string; count: number; volumeUSD: number }[]): string => {
  if (items.length === 0) return '  (none)';
  return items
    .map(
      (item) =>
        `    ${item.name.padEnd(10)} $${item.volumeUSD.toFixed(2).padStart(12)}  (${item.count} payments)`,
    )
    .join('\n');
};

export const registerGetDailyVolumeTool = (server: McpServer) => {
  server.registerTool(
    'get_daily_volume',
    {
      title: 'Get Daily Volume',
      description:
        'Returns the total payment volume for a given date, with breakdowns by network and currency. ' +
        'Only counts FILLED (completed) payments. Defaults to today if no date is specified.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (args: Input) => {
        const platformId = await resolveExternalPlatformId(args.externalPlatformId);

        // Resolve date
        const date = args.date ?? new Date().toISOString().slice(0, 10);
        const dateFrom = `${date}T00:00:00Z`;
        const dateTo = `${date}T23:59:59Z`;

        const payments = await fetchAllClosedPayments(platformId, dateFrom, dateTo);

        const totalVolumeUSD =
          Math.round(payments.reduce((sum, p) => sum + (p.filledAmountInUSD ?? 0), 0) * 100) / 100;
        const byNetwork = aggregate(payments, (p) => p.network);
        const byCurrency = aggregate(payments, (p) => p.currency);

        const message =
          `Daily Volume Report for ${date}:\n\n` +
          `  Total: $${totalVolumeUSD.toFixed(2)} (${payments.length} payments)\n\n` +
          `  By Network:\n${formatBreakdown(byNetwork)}\n\n` +
          `  By Currency:\n${formatBreakdown(byCurrency)}`;

        logger.info('Daily volume computed', {
          date,
          totalPayments: payments.length,
          totalVolumeUSD,
        });

        return {
          content: [textContent(message)],
          structuredContent: {
            date,
            totalPayments: payments.length,
            totalVolumeUSD,
            byNetwork,
            byCurrency,
          },
        };
      },
      { toolName: 'get_daily_volume' },
    ),
  );
};
