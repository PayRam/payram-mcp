import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';
import {
  buildNodeSdkCreatePaymentSnippet,
  buildNodeSdkPaymentStatusSnippet,
} from './templates/sdkTemplates.js';
import {
  buildGoHttpCreatePaymentSnippet,
  buildJavaHttpCreatePaymentSnippet,
  buildPhpHttpCreatePaymentSnippet,
  buildPythonHttpCreatePaymentSnippet,
  buildGenericHttpPaymentStatusSnippet,
} from './templates/httpTemplates.js';
import {
  buildExpressCreatePaymentRouteSnippet,
  buildNextjsRouteCreatePaymentSnippet,
} from './templates/routeTemplates.js';
import { SnippetResponse } from '../common/snippetTypes.js';

const supportedLanguages = ['typescript', 'javascript', 'python', 'go', 'php', 'java'] as const;
// TODO: Extend this list when we add fastapi/gin/laravel/spring-boot snippets.
const supportedFrameworks = ['generic-http', 'express', 'nextjs'] as const;

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
    framework: z
      .enum(['generic-http', 'express', 'nextjs'] as const)
      .describe(
        'Target framework for the SDK payment snippet. generic-http provides a framework-agnostic example.',
      ),
  })
  .strict();

const sdkSchemas = buildToolSchemas({
  input: sdkInputSchema,
  output: snippetResponseSchema,
});

const httpInputSchema = z
  .object({
    language: z
      .enum(['python', 'go', 'php', 'java'] as const)
      .describe('Programming language for the HTTP payment creation snippet'),
  })
  .strict();

const httpSchemas = buildToolSchemas({
  input: httpInputSchema,
  output: snippetResponseSchema,
});

const statusInputSchema = z
  .object({
    style: z
      .enum(['sdk', 'http'] as const)
      .describe('Style of code snippet: sdk uses the Payram SDK, http uses raw HTTP requests'),
  })
  .strict();

const statusSchemas = buildToolSchemas({
  input: statusInputSchema,
  output: snippetResponseSchema,
});

const routeInputSchema = z
  .object({
    framework: z
      .enum(['express', 'nextjs'] as const)
      .describe('Web framework for the payment route handler (Express.js or Next.js)'),
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

type GenerateSdkSnippetInput = z.infer<typeof sdkInputSchema>;
type GenerateHttpSnippetInput = z.infer<typeof httpInputSchema>;
type GenerateStatusSnippetInput = z.infer<typeof statusInputSchema>;
type GenerateRouteSnippetInput = z.infer<typeof routeInputSchema>;

const selectSdkSnippet = (framework: GenerateSdkSnippetInput['framework']) => {
  switch (framework) {
    case 'generic-http':
      return buildNodeSdkCreatePaymentSnippet();
    case 'express':
    case 'nextjs':
      throw new Error(`SDK snippet for ${framework} is not available yet.`);
    default:
      throw new Error(`Unsupported framework: ${framework}`);
  }
};

const selectHttpSnippet = (language: GenerateHttpSnippetInput['language']) => {
  switch (language) {
    case 'python':
      return buildPythonHttpCreatePaymentSnippet();
    case 'go':
      return buildGoHttpCreatePaymentSnippet();
    case 'php':
      return buildPhpHttpCreatePaymentSnippet();
    case 'java':
      return buildJavaHttpCreatePaymentSnippet();
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
};

const selectRouteSnippet = (framework: GenerateRouteSnippetInput['framework']) => {
  switch (framework) {
    case 'express':
      return buildExpressCreatePaymentRouteSnippet();
    case 'nextjs':
      return buildNextjsRouteCreatePaymentSnippet();
    default:
      throw new Error(`Unsupported framework: ${framework}`);
  }
};

export const registerPaymentTools = (server: McpServer) => {
  logger.debug('Registering payment tools...');

  server.registerTool(
    'generate_payment_sdk_snippet',
    {
      title: 'Generate SDK payment snippet',
      description:
        'Generates backend code using the official Payram JS/TS SDK to create a payment.',
      inputSchema: sdkSchemas.input,
      outputSchema: sdkSchemas.output,
    },
    safeHandler(
      async (params: GenerateSdkSnippetInput) => {
        const snippet = selectSdkSnippet(params.framework);
        logger.info(`Payment SDK snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram SDK snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_payment_sdk_snippet' },
    ),
  );

  server.registerTool(
    'generate_payment_http_snippet',
    {
      title: 'Generate HTTP payment snippet',
      description:
        'Generates a raw HTTP sample for creating a Payram payment in the requested language.',
      inputSchema: httpSchemas.input,
      outputSchema: httpSchemas.output,
    },
    safeHandler(
      async (params: GenerateHttpSnippetInput) => {
        const snippet = selectHttpSnippet(params.language);
        logger.info(`Payment HTTP snippet generated for ${params.language}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram HTTP snippet for ${params.language}.`,
        );
      },
      { toolName: 'generate_payment_http_snippet' },
    ),
  );

  server.registerTool(
    'generate_payment_status_snippet',
    {
      title: 'Generate payment status snippet',
      description: 'Generates backend code to query the status of a Payram payment.',
      inputSchema: statusSchemas.input,
      outputSchema: statusSchemas.output,
    },
    safeHandler(
      async (params: GenerateStatusSnippetInput) => {
        const snippet =
          params.style === 'sdk'
            ? buildNodeSdkPaymentStatusSnippet()
            : buildGenericHttpPaymentStatusSnippet();
        logger.info(`Payment status snippet generated via ${params.style}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram payment status snippet using ${params.style}.`,
        );
      },
      { toolName: 'generate_payment_status_snippet' },
    ),
  );

  server.registerTool(
    'generate_payment_route_snippet',
    {
      title: 'Generate payment route snippet',
      description:
        'Generates a ready-to-use backend endpoint (e.g., /api/pay/create) that creates a Payram payment.',
      inputSchema: routeSchemas.input,
      outputSchema: routeSchemas.output,
    },
    safeHandler(
      async (params: GenerateRouteSnippetInput) => {
        const snippet = selectRouteSnippet(params.framework);
        logger.info(`Payment route snippet generated for ${params.framework}`);
        return formatSnippetResponse(
          snippet,
          `Generated Payram route snippet for ${params.framework}.`,
        );
      },
      { toolName: 'generate_payment_route_snippet' },
    ),
  );
};
