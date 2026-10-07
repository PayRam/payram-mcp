import { logger } from '../../utils/logger.js';
import { MissingEnvironmentVariableError } from '../../config/env.js';
import { teachDirectApi } from '../guides/opsPlaybook.js';
import { textContent } from './content.js';

interface ToolErrorOptions {
  toolName?: string;
}

/** Strip server filesystem paths from messages shown to agents (R-API-FOR-AGENTS #2). */
const redactPaths = (message: string): string =>
  message.replace(
    /(?:\/var\/task|\/Users|\/home|\/root|\/tmp|\/private|[A-Z]:\\)[^\s'"`)]*/g,
    '<path>',
  );

const errorResult = (text: string) => ({ isError: true, content: [textContent(text)] });

/**
 * Wrap a tool handler so failures become tool results the model can act on.
 * Missing credentials become a direct-API recipe instead of a dead end.
 */
export const safeHandler = <Handler extends (...args: any[]) => Promise<any>>(
  handler: Handler,
  options?: ToolErrorOptions,
): Handler => {
  const toolName = options?.toolName ?? 'tool';

  const wrapped = async (...args: Parameters<Handler>): Promise<Awaited<ReturnType<Handler>>> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof MissingEnvironmentVariableError) {
        logger.info(`Tool ${toolName}: credentials not configured`);
        return errorResult(teachDirectApi(toolName) ?? error.message) as Awaited<
          ReturnType<Handler>
        >;
      }
      logger.error(`Tool ${toolName} failed`, { error: (error as Error)?.message });
      const message =
        error instanceof Error ? redactPaths(error.message) : 'Unexpected tool error.';
      return errorResult(message) as Awaited<ReturnType<Handler>>;
    }
  };

  return wrapped as Handler;
};
