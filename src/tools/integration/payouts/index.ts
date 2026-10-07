import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';
import { SnippetResponse } from '../common/snippetTypes.js';
import {
  buildNodeSdkCreatePayoutSnippet,
  buildNodeSdkPayoutStatusSnippet,
  buildRecipientPayoutFlowSnippet,
} from './templates/sdkTemplates.js';

const supportedLanguages = ['typescript'] as const;
const supportedFrameworks = ['generic-http'] as const;

const snippetMetaSchema = z.object({
  language: z.enum(supportedLanguages),
  framework: z.enum(supportedFrameworks),
  filenameSuggestion: z.string().optional(),
  description: z.string().optional(),
});

const snippetResponseSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  meta: snippetMetaSchema,
  notes: z.string().optional(),
});

const sdkInputSchema = z
  .object({
    framework: z.enum(supportedFrameworks).describe('Target framework for the payout SDK snippet'),
  })
  .strict();

const sdkSchemas = buildToolSchemas({
  input: sdkInputSchema,
  output: snippetResponseSchema,
});

const statusInputSchema = z.object({}).strict();

const statusSchemas = buildToolSchemas({
  input: statusInputSchema,
  output: snippetResponseSchema,
});

const textContent = (text: string) => ({ type: 'text' as const, text });
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

const formatSnippetResponse = (snippet: SnippetResponse, message: string) => ({
  content: [textContent(message)],
  structuredContent: toStructuredContent(snippet),
});

export const registerPayoutTools = (server: McpServer) => {
  logger.debug('Registering payout tools...');

  server.registerTool(
    'generate_payout_sdk_snippet',
    {
      title: 'Generate payout SDK snippet',
      description:
        'Generates a backend code snippet for creating a payout using the Payram JS/TS SDK.',
      inputSchema: sdkSchemas.input,
      outputSchema: sdkSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof sdkInputSchema>) => {
        if (params.framework !== 'generic-http') {
          throw new Error(`Unsupported framework for payout SDK snippets: ${params.framework}`);
        }
        const snippet = buildNodeSdkCreatePayoutSnippet();
        logger.info(`Payout SDK snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram payout SDK snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_payout_sdk_snippet' },
    ),
  );

  server.registerTool(
    'generate_payout_status_snippet',
    {
      title: 'Generate payout status SDK snippet',
      description: 'Generates backend code to query the status of a payout using the Payram SDK.',
      inputSchema: statusSchemas.input,
      outputSchema: statusSchemas.output,
    },
    safeHandler(
      async () => {
        const snippet = buildNodeSdkPayoutStatusSnippet();
        logger.info('Payout status SDK snippet generated');
        return formatSnippetResponse(snippet, 'Generated Payram payout status snippet.');
      },
      { toolName: 'generate_payout_status_snippet' },
    ),
  );

  server.registerTool(
    'generate_payout_recipient_flow_snippet',
    {
      title: 'Generate 3-step recipient payout flow snippet',
      description:
        'Generates the recommended OTP-verified payout flow: create recipient → validate OTP → create payout against the saved recipient. Use this for repeat beneficiaries; use generate_payout_sdk_snippet for one-off direct payouts.',
      inputSchema: statusSchemas.input,
      outputSchema: statusSchemas.output,
    },
    safeHandler(
      async () => {
        const snippet = buildRecipientPayoutFlowSnippet();
        logger.info('Payout recipient-flow snippet generated');
        return formatSnippetResponse(
          snippet,
          'Generated Payram 3-step recipient payout flow snippet.',
        );
      },
      { toolName: 'generate_payout_recipient_flow_snippet' },
    ),
  );
};
