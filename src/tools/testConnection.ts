import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { safeHandler } from './common/errors.js';
import { runDoctor } from './doctor.js';
import { textContent } from './common/content.js';

/**
 * test_payram_connection — "can I reach this PayRam, and does my key work?"
 *
 * Read-only. Earlier versions created a real $1 payment for customer "1001"
 * (which also cancels that customer's open payments); this now delegates to
 * payram_doctor's side-effect-free probes.
 */

const inputSchema = z.object({
  baseUrl: z
    .string()
    .optional()
    .describe(
      'PayRam URL, same origin as the dashboard (e.g. https://pay.example.com). Defaults to PAYRAM_BASE_URL in local mode.',
    ),
  apiKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional project API key to validate (nothing is created). Passing it exposes the key in this conversation.',
    ),
});

const outputSchema = z.object({
  ok: z.boolean(),
  baseUrl: z.string(),
  payramVersion: z.string().optional(),
  keyChecked: z.boolean(),
  errorMessage: z.string().optional(),
});

export const registerTestConnectionTool = (server: McpServer) => {
  server.registerTool(
    'test_payram_connection',
    {
      title: 'Test PayRam connectivity',
      description:
        'Read-only check that a PayRam server is reachable and healthy and, if an API key is supplied, that the key is accepted. Never creates payments. For a full diagnosis use payram_doctor.',
      inputSchema,
      outputSchema,
    },
    safeHandler(
      async (args: z.infer<typeof inputSchema>) => {
        const report = await runDoctor(args, { connectivityOnly: true });
        const keyFinding = report.findings.find((f) => f.check === 'api-key');
        const blocking =
          report.failedStage &&
          ['input', 'reachability', 'health', 'api-key'].includes(report.failedStage);
        const ok = !blocking;
        const firstCause = report.likelyCauses[0];
        const errorMessage = ok
          ? undefined
          : `${report.failedStage}: ${firstCause ? `${firstCause.cause} → ${firstCause.fix}` : 'check failed'}`;
        const lines = [
          ok
            ? `PayRam at ${report.baseUrl} is reachable${report.version ? ` (v${report.version})` : ''}.`
            : `Connection check failed — ${errorMessage}`,
          keyFinding ? `API key: ${keyFinding.detail}` : 'API key: not checked (none supplied).',
          ...report.warnings.map((w) => `Warning: ${w}`),
        ];
        return {
          content: [textContent(lines.join('\n'))],
          structuredContent: {
            ok,
            baseUrl: report.baseUrl ?? args.baseUrl ?? 'N/A',
            payramVersion: report.version ?? undefined,
            keyChecked: Boolean(keyFinding),
            errorMessage,
          },
        };
      },
      { toolName: 'test_payram_connection' },
    ),
  );
};
