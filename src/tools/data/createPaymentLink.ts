import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { createPaymentLink } from '../../api/payramApi.js';

const inputSchema = z
  .object({
    amountInUSD: z.number().positive().describe('Payment amount in USD (must be > 0)'),
    customerID: z
      .string()
      .min(1)
      .describe('Your internal customer identifier (sent as customerID, required)'),
    customerEmail: z
      .string()
      .email()
      .describe('Customer email (required — the backend validates it as a non-empty email)'),
  })
  .strict();

const schemas = buildToolSchemas({
  input: inputSchema,
  output: z
    .object({
      url: z.string(),
      reference_id: z.string(),
      host: z.string().optional(),
    })
    .passthrough(),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

export const registerCreatePaymentLinkTool = (server: McpServer) => {
  server.registerTool(
    'create_payment_link',
    {
      title: 'Create Payment Link',
      description:
        'Creates a PayRam checkout (payment) link and returns the hosted URL plus a reference_id. ' +
        'Authenticates with the Merchant API-Key (set PAYRAM_API_KEY). ' +
        'This WRITES — it creates a real payment request. The customer chooses the chain/currency on the hosted checkout. ' +
        'Poll status later with lookup_payment (or GET /api/v1/payment/reference/{reference_id}).',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof inputSchema>) => {
        const link = await createPaymentLink({
          amountInUSD: params.amountInUSD,
          customerID: params.customerID,
          customerEmail: params.customerEmail,
        });

        logger.info('Payment link created', { referenceId: link.reference_id });

        const message =
          `Payment link created.\n` +
          `  Reference: ${link.reference_id}\n` +
          `  Checkout:  ${link.url}` +
          (link.host ? `\n  Host:      ${link.host}` : '');

        return {
          content: [textContent(message)],
          structuredContent: { ...link },
        };
      },
      { toolName: 'create_payment_link' },
    ),
  );
};
