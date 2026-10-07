import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { listCurrencies } from '../../api/payramApi.js';

const currencySchema = z
  .object({
    id: z.number(),
    blockchainCode: z.string(),
    network: z.string().optional(),
    currencyCode: z.string(),
    currency: z.string().optional(),
  })
  .passthrough();

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: z.object({
    currencies: z.array(currencySchema),
    count: z.number(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

export const registerListCurrenciesTool = (server: McpServer) => {
  server.registerTool(
    'list_currencies',
    {
      title: 'List Supported Currencies',
      description:
        'Lists every blockchain currency PayRam supports on this node (chain code, network, currency code). ' +
        'Public endpoint — works with only PAYRAM_BASE_URL set, no API key or JWT required. ' +
        'Use this to discover valid blockchainCode/currencyCode values before creating payments or payouts.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        const currencies = await listCurrencies();

        let message: string;
        if (currencies.length === 0) {
          message = 'No currencies returned by this PayRam node.';
        } else {
          const header = `Supported currencies (${currencies.length}):\n`;
          const rows = currencies
            .map(
              (c) =>
                `  ${c.currencyCode.padEnd(8)} on ${c.blockchainCode}${c.network ? ` (${c.network})` : ''}`,
            )
            .join('\n');
          message = `${header}\n${rows}`;
        }

        logger.info('Currencies listed', { count: currencies.length });

        return {
          content: [textContent(message)],
          structuredContent: {
            currencies,
            count: currencies.length,
          },
        };
      },
      { toolName: 'list_currencies' },
    ),
  );
};
