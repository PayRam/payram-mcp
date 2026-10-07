import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { searchPayments } from '../../api/payramApi.js';
import { resolveExternalPlatformId } from './index.js';
import type { PaymentData } from '../../api/types.js';

const paymentDataSchema = z.object({
  projectName: z.string(),
  blockId: z.number().optional(),
  referenceId: z.string().optional(),
  txHash: z.string().optional(),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
  paymentStatus: z.string(),
  currency: z.string().optional(),
  network: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  invoiceId: z.string().optional(),
  customerId: z.string().optional(),
  email: z.string().optional(),
  amountInUSD: z.number().optional(),
  amount: z.number().optional(),
  filledAmountInUSD: z.number().optional(),
  filledAmount: z.number().optional(),
  paymasterFee: z.number().optional(),
  paymasterFeeInUSD: z.number().optional(),
  onRamperFee: z.number().optional(),
  onRamperFeeInUSD: z.number().optional(),
  createdBy: z.string(),
  trxTimestamp: z.string().optional(),
  webhookStatus: z.string().optional(),
});

const schemas = buildToolSchemas({
  input: z
    .object({
      query: z
        .string()
        .min(1)
        .describe(
          'Search query: transaction hash, email address, reference ID (UUID), customer ID, or invoice ID. ' +
            'The backend auto-detects the query type.',
        ),
      externalPlatformId: z
        .string()
        .optional()
        .describe('Optional. Auto-discovered from your account if omitted.'),
    })
    .strict(),
  output: z.object({
    payments: z.array(paymentDataSchema),
    totalCount: z.number(),
  }),
});

type Input = z.infer<typeof schemas.input>;

const textContent = (text: string) => ({ type: 'text' as const, text });

const formatPayment = (p: PaymentData, i: number): string => {
  const lines = [`  ${i + 1}. ${p.paymentStatus.toUpperCase()}`];
  if (p.amountInUSD != null) lines.push(`     Amount: $${p.amountInUSD}`);
  if (p.filledAmountInUSD != null) lines.push(`     Filled: $${p.filledAmountInUSD}`);
  if (p.currency) lines.push(`     Currency: ${p.currency}`);
  if (p.network) lines.push(`     Network: ${p.network}`);
  if (p.txHash) lines.push(`     Tx Hash: ${p.txHash}`);
  if (p.referenceId) lines.push(`     Reference: ${p.referenceId}`);
  if (p.email) lines.push(`     Email: ${p.email}`);
  if (p.createdAt) lines.push(`     Created: ${p.createdAt}`);
  return lines.join('\n');
};

export const registerLookupPaymentTool = (server: McpServer) => {
  server.registerTool(
    'lookup_payment',
    {
      title: 'Lookup Payment',
      description:
        'Look up payments by transaction hash, email, reference ID, customer ID, or invoice ID. ' +
        'Returns up to 5 matching payments with full details.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (args: Input) => {
        const platformId = await resolveExternalPlatformId(args.externalPlatformId);
        const result = await searchPayments(platformId, {
          query: args.query,
          limit: 5,
        });

        const count = result.data.length;
        const total = result.totalCount;

        let message: string;
        if (count === 0) {
          message = `No payments found matching '${args.query}'.`;
        } else {
          const header =
            total > count
              ? `Found ${total} payment(s) matching '${args.query}' (showing first ${count}):`
              : `Found ${count} payment(s) matching '${args.query}':`;
          const details = result.data.map(formatPayment).join('\n\n');
          message = `${header}\n\n${details}`;
        }

        logger.info('Payment lookup completed', { query: args.query, totalCount: total });

        return {
          content: [textContent(message)],
          structuredContent: {
            payments: result.data.map((p) => ({ ...p })),
            totalCount: total,
          },
        };
      },
      { toolName: 'lookup_payment' },
    ),
  );
};
