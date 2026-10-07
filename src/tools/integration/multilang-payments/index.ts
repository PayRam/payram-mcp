import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';
import { SnippetResponse } from '../common/snippetTypes.js';
import { buildExpressPaymentRouteSnippet } from './templates/expressRouteTemplate.js';
import { buildFastapiPaymentRouteSnippet } from './templates/fastapiRouteTemplate.js';
import { buildGoPaymentHandlerSnippet } from './templates/goRouteTemplate.js';
import { buildLaravelPaymentRouteSnippet } from './templates/laravelRouteTemplate.js';
import { buildNextjsPaymentRouteSnippet } from './templates/nextjsRouteTemplate.js';
import { buildSpringPaymentControllerSnippet } from './templates/springRouteTemplate.js';

const snippetMetaSchema = z.object({
  language: z.enum(['typescript', 'javascript', 'python', 'go', 'php', 'java'] as const),
  framework: z.enum([
    'nextjs',
    'express',
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

const emptySchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: snippetResponseSchema,
});

const textContent = (text: string) => ({ type: 'text' as const, text });
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

const formatSnippetResponse = (snippet: SnippetResponse, message: string) => ({
  content: [textContent(message)],
  structuredContent: toStructuredContent(snippet),
});

type Builder = () => SnippetResponse;

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  successMessage: string;
  builder: Builder;
};

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'snippet_nextjs_payment_route',
    title: 'Next.js create-payment route snippet',
    description:
      "Returns a Next.js App Router API route that calls Payram's create-payment HTTP API.",
    successMessage: 'Generated Next.js Payram create-payment route.',
    builder: buildNextjsPaymentRouteSnippet,
  },
  {
    name: 'snippet_express_payment_route',
    title: 'Express create-payment route snippet',
    description: "Returns an Express router that posts to Payram's /api/v1/payment endpoint.",
    successMessage: 'Generated Express Payram create-payment route.',
    builder: buildExpressPaymentRouteSnippet,
  },
  {
    name: 'snippet_fastapi_payment_route',
    title: 'FastAPI create-payment route snippet',
    description: "Returns a FastAPI handler that calls Payram's create-payment HTTP API.",
    successMessage: 'Generated FastAPI Payram create-payment route.',
    builder: buildFastapiPaymentRouteSnippet,
  },
  {
    name: 'snippet_laravel_payment_route',
    title: 'Laravel create-payment route snippet',
    description: "Returns a Laravel controller that posts to Payram's /api/v1/payment endpoint.",
    successMessage: 'Generated Laravel Payram create-payment route.',
    builder: buildLaravelPaymentRouteSnippet,
  },
  {
    name: 'snippet_go_payment_handler',
    title: 'Go (Gin) create-payment route snippet',
    description:
      "Returns a Gin handler that proxies /api/pay/create to Payram's create-payment API.",
    successMessage: 'Generated Go (Gin) Payram create-payment route.',
    builder: buildGoPaymentHandlerSnippet,
  },
  {
    name: 'snippet_spring_payment_controller',
    title: 'Spring Boot create-payment controller snippet',
    description: "Returns a Spring Boot controller that calls Payram's /api/v1/payment endpoint.",
    successMessage: 'Generated Spring Boot Payram create-payment controller.',
    builder: buildSpringPaymentControllerSnippet,
  },
];

export const registerMultilangPaymentTools = (server: McpServer) => {
  logger.debug('Registering multi-language payment route snippet tools');

  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: emptySchemas.input,
        outputSchema: emptySchemas.output,
      },
      safeHandler(
        async () => {
          const snippet = tool.builder();
          logger.info(`${tool.name} generated`);
          return formatSnippetResponse(snippet, tool.successMessage);
        },
        { toolName: tool.name },
      ),
    );
  }
};
