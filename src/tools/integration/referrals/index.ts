import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';
import { SnippetResponse } from '../common/snippetTypes.js';
import {
  buildNodeSdkCreateReferralSnippet,
  buildNodeSdkReferralStatusSnippet,
} from './templates/sdkTemplates.js';
import {
  buildReferralValidationSnippet,
  buildBackendReferralStatusSnippet,
} from './templates/validationTemplates.js';
import {
  buildExpressReferralRouteSnippet,
  buildNextjsReferralRouteSnippet,
} from './templates/routeTemplates.js';

const supportedLanguages = ['typescript'] as const;
const sdkFrameworks = ['generic-http'] as const;
const routeFrameworks = ['express', 'nextjs'] as const;

const snippetMetaSchema = z.object({
  language: z.enum(supportedLanguages),
  framework: z.enum(['generic-http', 'express', 'nextjs'] as const),
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
    framework: z.enum(sdkFrameworks).describe('Target framework for the referral SDK snippet'),
  })
  .strict();

const sdkSchemas = buildToolSchemas({
  input: sdkInputSchema,
  output: snippetResponseSchema,
});

const validationSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: snippetResponseSchema,
});

const statusInputSchema = z
  .object({
    style: z
      .enum(['sdk', 'backend-only'] as const)
      .describe(
        'Style of code snippet: sdk uses the Payram SDK, backend-only shows direct API calls',
      ),
  })
  .strict();

const statusSchemas = buildToolSchemas({
  input: statusInputSchema,
  output: snippetResponseSchema,
});

const routeInputSchema = z
  .object({
    framework: z
      .enum(routeFrameworks)
      .describe('Web framework for the referral route handler (Express.js or Next.js)'),
  })
  .strict();

const routeSchemas = buildToolSchemas({
  input: routeInputSchema,
  output: snippetResponseSchema,
});

const textContent = (text: string) => ({ type: 'text' as const, text });
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

const formatSnippetResponse = (snippet: SnippetResponse, message: string) => ({
  content: [textContent(message)],
  structuredContent: toStructuredContent(snippet),
});

export const registerReferralTools = (server: McpServer) => {
  logger.debug('Registering referral tools...');

  server.registerTool(
    'generate_referral_sdk_snippet',
    {
      title: 'Generate referral SDK snippet',
      description:
        'Generates a backend route or service snippet to create a referral event using the Payram SDK.',
      inputSchema: sdkSchemas.input,
      outputSchema: sdkSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof sdkInputSchema>) => {
        if (params.framework !== 'generic-http') {
          throw new Error(`Unsupported framework for referral SDK snippets: ${params.framework}`);
        }
        const snippet = buildNodeSdkCreateReferralSnippet();
        logger.info(`Referral SDK snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram referral SDK snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_referral_sdk_snippet' },
    ),
  );

  server.registerTool(
    'generate_referral_validation_snippet',
    {
      title: 'Generate referral validation snippet',
      description: 'Generates a snippet to validate referral IDs, statuses, and eligibility.',
      inputSchema: validationSchemas.input,
      outputSchema: validationSchemas.output,
    },
    safeHandler(
      async () => {
        const snippet = buildReferralValidationSnippet();
        logger.info('Referral validation snippet generated');
        return formatSnippetResponse(snippet, 'Generated referral validation helper.');
      },
      { toolName: 'generate_referral_validation_snippet' },
    ),
  );

  server.registerTool(
    'generate_referral_status_snippet',
    {
      title: 'Generate referral status snippet',
      description: 'Generates code to fetch referral progress, rewards, or status.',
      inputSchema: statusSchemas.input,
      outputSchema: statusSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof statusInputSchema>) => {
        const snippet =
          params.style === 'sdk'
            ? buildNodeSdkReferralStatusSnippet()
            : buildBackendReferralStatusSnippet();
        logger.info(`Referral status snippet generated via ${params.style}`);
        return formatSnippetResponse(
          snippet,
          `Generated referral status snippet using ${params.style}.`,
        );
      },
      { toolName: 'generate_referral_status_snippet' },
    ),
  );

  server.registerTool(
    'generate_referral_route_snippet',
    {
      title: 'Generate referral route snippet',
      description:
        'Generates a backend route such as /api/referrals/create for logging referral events.',
      inputSchema: routeSchemas.input,
      outputSchema: routeSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof routeInputSchema>) => {
        const snippet =
          params.framework === 'express'
            ? buildExpressReferralRouteSnippet()
            : buildNextjsReferralRouteSnippet();
        logger.info(`Referral route snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated referral route snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_referral_route_snippet' },
    ),
  );
};
