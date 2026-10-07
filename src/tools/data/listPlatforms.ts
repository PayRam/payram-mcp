import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { listPlatforms } from '../../api/payramApi.js';

const platformSchema = z.object({
  id: z.number(),
  name: z.string(),
  referenceId: z.string().optional(),
  createdAt: z.string().optional(),
});

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: z.object({
    platforms: z.array(platformSchema),
    count: z.number(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

export const registerListPlatformsTool = (server: McpServer) => {
  server.registerTool(
    'list_platforms',
    {
      title: 'List Platforms',
      description:
        'Lists all external platforms (projects) for the authenticated user. ' +
        'Use this to discover your platform ID, which other tools auto-resolve if omitted.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        const platforms = await listPlatforms();

        let message: string;
        if (platforms.length === 0) {
          message = 'No platforms found. Create a project in the PayRam dashboard first.';
        } else {
          const header = `Found ${platforms.length} platform(s):\n`;
          const rows = platforms.map((p, i) => `  ${i + 1}. ${p.name} (ID: ${p.id})`).join('\n');
          message = `${header}\n${rows}`;
        }

        logger.info('Platforms listed', { count: platforms.length });

        return {
          content: [textContent(message)],
          structuredContent: {
            platforms: platforms.map((p) => ({ ...p })),
            count: platforms.length,
          },
        };
      },
      { toolName: 'list_platforms' },
    ),
  );
};
