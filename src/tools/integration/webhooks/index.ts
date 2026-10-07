import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';
import { SnippetResponse } from '../common/snippetTypes.js';
import {
  buildExpressWebhookHandlerSnippet,
  buildNextjsWebhookHandlerSnippet,
  buildFastapiWebhookHandlerSnippet,
  buildGinWebhookHandlerSnippet,
  buildLaravelWebhookHandlerSnippet,
  buildSpringBootWebhookHandlerSnippet,
} from './templates/handlerTemplates.js';
import { buildWebhookEventRouterSnippet } from './templates/routerTemplates.js';
import {
  buildCurlMockWebhookEventSnippet,
  buildPythonMockWebhookEventSnippet,
  buildGoMockWebhookEventSnippet,
  buildPhpMockWebhookEventSnippet,
  buildJavaMockWebhookEventSnippet,
} from './templates/mockTemplates.js';
import { PayramWebhookStatus } from './webhookTypes.js';

const snippetMetaSchema = z.object({
  language: z.enum(['typescript', 'javascript', 'python', 'go', 'php', 'java'] as const),
  framework: z.enum([
    'express',
    'nextjs',
    'fastapi',
    'gin',
    'laravel',
    'spring-boot',
    'generic-http',
  ] as const),
  filenameSuggestion: z.string().optional(),
  description: z.string().optional(),
});

const snippetResponseSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  meta: snippetMetaSchema,
  notes: z.string().optional(),
});

const handlerInputSchema = z
  .object({
    framework: z
      .enum(['express', 'nextjs', 'fastapi', 'gin', 'laravel', 'spring-boot'] as const)
      .describe('Web framework for the webhook handler code'),
  })
  .strict();

const handlerSchemas = buildToolSchemas({
  input: handlerInputSchema,
  output: snippetResponseSchema,
});

const routerSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: snippetResponseSchema,
});

const mockInputSchema = z
  .object({
    language: z
      .enum(['curl', 'python', 'go', 'php', 'java'] as const)
      .describe('Language/tool for the mock webhook request (curl for command-line testing)'),
    status: z
      .enum([
        'OPEN',
        'CANCELLED',
        'FILLED',
        'PARTIALLY_FILLED',
        'OVER_FILLED',
        'UNDEFINED',
      ] as const)
      .describe('Payment status to simulate in the mock webhook event'),
  })
  .strict();

const mockSchemas = buildToolSchemas({
  input: mockInputSchema,
  output: snippetResponseSchema,
});

const textContent = (text: string) => ({ type: 'text' as const, text });
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

const formatSnippetResponse = (snippet: SnippetResponse, message: string) => ({
  content: [textContent(message)],
  structuredContent: toStructuredContent(snippet),
});

const handlerBuilders: Record<
  z.infer<typeof handlerInputSchema>['framework'],
  () => SnippetResponse
> = {
  express: buildExpressWebhookHandlerSnippet,
  nextjs: buildNextjsWebhookHandlerSnippet,
  fastapi: buildFastapiWebhookHandlerSnippet,
  gin: buildGinWebhookHandlerSnippet,
  laravel: buildLaravelWebhookHandlerSnippet,
  'spring-boot': buildSpringBootWebhookHandlerSnippet,
};

const mockBuilders: Record<
  z.infer<typeof mockInputSchema>['language'],
  (status: PayramWebhookStatus) => SnippetResponse
> = {
  curl: buildCurlMockWebhookEventSnippet,
  python: buildPythonMockWebhookEventSnippet,
  go: buildGoMockWebhookEventSnippet,
  php: buildPhpMockWebhookEventSnippet,
  java: buildJavaMockWebhookEventSnippet,
};

export const registerWebhookTools = (server: McpServer) => {
  logger.debug('Registering webhook integration tools (multi-language)...');

  server.registerTool(
    'generate_webhook_handler',
    {
      title: 'Generate Payram webhook HTTP handler',
      description: 'Generates backend code to handle Payram webhook HTTP requests.',
      inputSchema: handlerSchemas.input,
      outputSchema: handlerSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof handlerInputSchema>) => {
        const builder = handlerBuilders[params.framework];

        if (!builder) {
          throw new Error(`Unsupported webhook framework: ${params.framework}`);
        }

        const snippet = builder();
        logger.info(`Webhook handler snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram webhook handler snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_webhook_handler' },
    ),
  );

  server.registerTool(
    'generate_webhook_event_router',
    {
      title: 'Generate Payram webhook event router',
      description:
        'Generates a backend event router that dispatches Payram webhook events to domain handlers.',
      inputSchema: routerSchemas.input,
      outputSchema: routerSchemas.output,
    },
    safeHandler(
      async () => {
        const snippet = buildWebhookEventRouterSnippet();
        logger.info('Webhook event router snippet generated');
        return formatSnippetResponse(snippet, 'Generated Payram webhook event router snippet.');
      },
      { toolName: 'generate_webhook_event_router' },
    ),
  );

  server.registerTool(
    'generate_mock_webhook_event',
    {
      title: 'Generate mock Payram webhook event',
      description:
        'Generates a snippet to send mock Payram webhook events to your local endpoint for testing.',
      inputSchema: mockSchemas.input,
      outputSchema: mockSchemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof mockInputSchema>) => {
        const builder = mockBuilders[params.language];

        if (!builder) {
          throw new Error(`Unsupported mock webhook language: ${params.language}`);
        }

        const snippet = builder(params.status);
        logger.info(`Mock webhook event snippet generated for ${params.language}`);
        return formatSnippetResponse(snippet, 'Generated mock Payram webhook event sender.');
      },
      { toolName: 'generate_mock_webhook_event' },
    ),
  );
};
