import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { PAYRAM_ENV_TEMPLATE } from './content/envTemplateContent.js';
import { PAYRAM_SETUP_CHECKLIST } from './content/setupChecklistContent.js';
import { PAYRAM_FILE_STRUCTURE } from './content/fileStructureContent.js';
import { AGENT_ONBOARDING_MD } from '../../generated/buildInfo.js';
import { buildSetupPlan, renderSetupPlan } from '../guides/setupPlan.js';
import { INSTALL } from '../../facts/payram.js';

const textContent = (text: string) => ({ type: 'text' as const, text });

/** Known gaps in the synced upstream guide, shown until payram-scripts fixes them. */
const ONBOARDING_ERRATA = `> **Notes from the PayRam MCP (read first)**
> - Run subcommands without a local checkout: \`${INSTALL.agentCli} <command>\` (the one-liner does not leave ./setup_payram_agents.sh on disk).
> - \`node-status\` / \`node-restart\` do not work as standalone commands on the current script; use payram_ops_playbook "node_sync" and "restart_worker".
> - Backend errors are not in \`docker logs payram\`; see ~/.payram-core/log/ (payram_ops_playbook "logs").
> - A headless install stores http://localhost as the site URL, so payment links are not reachable from outside until the human saves Settings → Site URL on the public domain (payram_runbook "set_site_url").
> - \`reset-local\` destroys the database, AES key and wallet secrets: test servers only, back up first, never with -y on a real install.
> - Leave the Analytics MCP server off (--skip-mcp-server) or make sure port 3333 is not reachable (payram_runbook "secure_analytics_mcp").`;
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

const envVarDefinitionSchema = z.object({
  key: z.string(),
  required: z.boolean(),
  description: z.string(),
  example: z.string().optional(),
  defaultValue: z.string().optional(),
  docsRefs: z.array(z.string()).optional(),
});

const envTemplateResponseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  envExample: z.string(),
  variables: z.array(envVarDefinitionSchema),
  notes: z.string().optional(),
});

const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  docsRefs: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
});

const setupChecklistResponseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  items: z.array(checklistItemSchema),
  notes: z.string().optional(),
});

const fileStructureNodeSchema: z.ZodType<{
  path: string;
  type: 'file' | 'folder';
  description?: string;
  children?: any;
}> = z.lazy(() =>
  z.object({
    path: z.string(),
    type: z.enum(['file', 'folder']),
    description: z.string().optional(),
    children: z.array(fileStructureNodeSchema).optional(),
  }),
);

const fileStructureResponseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  root: fileStructureNodeSchema,
  notes: z.string().optional(),
});

const envTemplateSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: envTemplateResponseSchema,
});

const setupChecklistSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: setupChecklistResponseSchema,
});

const fileStructureSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: fileStructureResponseSchema,
});

const agentSetupGuideResponseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  markdown: z.string(),
});

const agentSetupGuideSchemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: agentSetupGuideResponseSchema,
});

const formatChecklistMarkdown = () => {
  const header = `## ${PAYRAM_SETUP_CHECKLIST.title}`;
  const description = PAYRAM_SETUP_CHECKLIST.description
    ? `\n${PAYRAM_SETUP_CHECKLIST.description}`
    : '';
  const items = PAYRAM_SETUP_CHECKLIST.items
    .map((item, index) => {
      const optional = item.optional ? ' (optional)' : '';
      const refs = item.docsRefs?.length ? `\n   Docs: ${item.docsRefs.join(', ')}` : '';
      return `${index + 1}. **${item.label}**${optional} - ${item.description}${refs}`;
    })
    .join('\n');
  const notes = PAYRAM_SETUP_CHECKLIST.notes ? `\n\nNotes: ${PAYRAM_SETUP_CHECKLIST.notes}` : '';
  return `${header}${description}\n\n${items}${notes}`;
};

export const registerSetupTools = (server: McpServer) => {
  logger.debug('Registering merchant setup tools...');

  server.registerTool(
    'generate_env_template',
    {
      title: 'Generate Payram .env Template',
      description:
        'Creates a .env template for configuring a merchant backend to talk to a self-hosted Payram server.',
      inputSchema: envTemplateSchemas.input,
      outputSchema: envTemplateSchemas.output,
    },
    safeHandler(
      async () => ({
        content: [textContent('Generated Payram environment template.')],
        structuredContent: toStructuredContent(PAYRAM_ENV_TEMPLATE),
      }),
      { toolName: 'generate_env_template' },
    ),
  );

  server.registerTool(
    'generate_setup_checklist',
    {
      title: 'Generate Payram Setup Checklist',
      description:
        'Returns a step-by-step checklist of everything a merchant must configure to start using Payram.',
      inputSchema: setupChecklistSchemas.input,
      outputSchema: setupChecklistSchemas.output,
    },
    safeHandler(
      async () => ({
        content: [
          textContent('Delivered merchant setup checklist.'),
          textContent(formatChecklistMarkdown()),
        ],
        structuredContent: toStructuredContent(PAYRAM_SETUP_CHECKLIST),
      }),
      { toolName: 'generate_setup_checklist' },
    ),
  );

  server.registerTool(
    'suggest_file_structure',
    {
      title: 'Suggest Payram File Structure',
      description: 'Suggests a recommended backend folder/file structure for integrating Payram.',
      inputSchema: fileStructureSchemas.input,
      outputSchema: fileStructureSchemas.output,
    },
    safeHandler(
      async () => ({
        content: [textContent('Provided recommended Payram file structure.')],
        structuredContent: toStructuredContent(PAYRAM_FILE_STRUCTURE),
      }),
      { toolName: 'suggest_file_structure' },
    ),
  );

  server.registerTool(
    'get_agent_setup_flow',
    {
      title: 'Get the headless agent guide (full reference)',
      description:
        'Returns the canonical PayRam headless-agent guide: agent CLI commands, env vars, merchant vs operator mode, wallet flows, adding chains, troubleshooting. Long (~11k tokens). For a short personalised plan use payram_setup_plan.',
      inputSchema: agentSetupGuideSchemas.input,
      outputSchema: agentSetupGuideSchemas.output,
    },
    safeHandler(
      async () => {
        const response = {
          title: 'PayRam headless agent guide',
          description: 'Canonical reference for the setup_payram_agents.sh flow.',
          markdown: `${ONBOARDING_ERRATA}\n\n${AGENT_ONBOARDING_MD}`,
        };
        return {
          content: [textContent(response.markdown)],
          structuredContent: toStructuredContent(response),
        };
      },
      { toolName: 'get_agent_setup_flow' },
    ),
  );
};

/** Older entry points kept working but listed last; each says what replaced it. */
export const registerLegacySetupTools = (server: McpServer) => {
  server.registerTool(
    'onboard_agent_setup',
    {
      title: 'Onboard: install PayRam as an agent (deprecated)',
      description:
        'Deprecated: use payram_setup_plan, which does this and lets you personalise it. Returns the default headless plan (testnet, USDC on Base).',
      inputSchema: agentSetupGuideSchemas.input,
      outputSchema: agentSetupGuideSchemas.output,
    },
    safeHandler(
      async () => {
        const markdown = renderSetupPlan(buildSetupPlan({}));
        const response = {
          title: 'PayRam agent onboarding (default plan)',
          description: 'Headless install on testnet with a USDC-on-Base deposit wallet.',
          markdown,
        };
        return {
          content: [textContent(markdown)],
          structuredContent: toStructuredContent(response),
        };
      },
      { toolName: 'onboard_agent_setup' },
    ),
  );
};
