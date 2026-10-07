import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { listRecipients } from '../../api/payramApi.js';

const recipientSchema = z
  .object({
    id: z.number(),
    // Pointer fields without omitempty in core — they serialize as null,
    // which .optional() rejects; .nullish() accepts undefined AND null.
    name: z.string().nullish(),
    email: z.string().nullish(),
    blockchainCode: z.string(),
    address: z.string(),
    status: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: z.object({
    recipients: z.array(recipientSchema),
    count: z.number(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

export const registerListRecipientsTool = (server: McpServer) => {
  server.registerTool(
    'list_recipients',
    {
      title: 'List Payout Recipients',
      description:
        'Lists saved withdrawal recipients (payout beneficiaries). ' +
        'Use this to find a recipient ID for the 3-step payout flow, or to check whether a beneficiary ' +
        'is already OTP-verified (status "active") before creating a payout.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        const { recipients, total } = await listRecipients();

        let message: string;
        if (recipients.length === 0) {
          message =
            'No recipients found. Create one via POST /api/v1/recipients, then verify its OTP.';
        } else {
          const truncated = total > recipients.length;
          const header = truncated
            ? `Found ${total} recipient(s) — showing the first ${recipients.length} (server caps the page at 100):\n`
            : `Found ${total} recipient(s):\n`;
          const rows = recipients
            .map(
              (r) =>
                `  #${r.id} ${(r.name ?? r.email ?? '—').padEnd(24)} ${r.blockchainCode.padEnd(10)} ` +
                `${r.address.slice(0, 12)}…  [${r.status}]`,
            )
            .join('\n');
          message = `${header}\n${rows}`;
        }

        logger.info('Recipients listed', { count: recipients.length, total });

        return {
          content: [textContent(message)],
          structuredContent: {
            recipients,
            count: total,
          },
        };
      },
      { toolName: 'list_recipients' },
    ),
  );
};
