import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../utils/logger.js';
import { z } from 'zod';
import { WEBHOOK } from '../facts/payram.js';

/**
 * Prompts: ready-made starting points that route into the right tools.
 */

const userText = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

export const registerPrompts = (server: McpServer) => {
  logger.debug('Registering prompts...');

  server.registerPrompt(
    'setup-payram',
    {
      title: 'Set up PayRam',
      description: 'Plan and run a PayRam install on a server, with the human hand-offs called out',
      argsSchema: z.object({
        domain: z
          .string()
          .optional()
          .describe('Public hostname for the gateway, e.g. pay.example.com'),
        network: z.string().optional().describe('testnet (recommended first) or mainnet'),
      }),
    },
    async (args) =>
      userText(`Help me set up PayRam${args.domain ? ` at ${args.domain}` : ''}${args.network ? ` on ${args.network}` : ''}.
1. Ask me anything payram_setup_plan needs that I have not said: whether you can run commands on my server over SSH or I will run them and paste the output back (access), domain, testnet or mainnet, human dashboard or headless agent, first wallet (USDC on Base or BTC), merchant or operator, and whether a store/app will connect.
2. Call payram_setup_plan and walk me through it one phase at a time. Run the agent steps over SSH only when I have given you access; stop at every step marked HUMAN or STOP and tell me exactly what to do.
3. After install, call payram_doctor with the public URL and fix anything it reports. If any step fails, call payram_troubleshoot with the error text (without keys or passwords).
4. Finish with backups and the daily check (payram_runbook "backup", payram_ops_playbook "daily_check").`),
  );

  server.registerPrompt(
    'setup-payram-agent',
    {
      title: 'Set up PayRam headless (agent)',
      description: 'Headless install by an agent with SSH access to the server',
    },
    async () =>
      userText(
        `You are installing PayRam on a server you can reach over SSH. Call payram_setup_plan with path "agent" (ask me for the domain and network first), then follow it. The first install needs an interactive terminal once (ssh -t). Hand me the root credentials privately, ask me to save Settings → Site URL on the public domain, and never choose the cold wallet or spend mainnet gas without my explicit OK. For the full CLI reference call get_agent_setup_flow.`,
      ),
  );

  server.registerPrompt(
    'integrate-payment',
    {
      title: 'Integrate PayRam payments',
      description: 'Add PayRam checkout and webhook handling to an application',
      argsSchema: z.object({
        framework: z
          .string()
          .optional()
          .describe('Your web framework (e.g., express, nextjs, fastapi, laravel, gin, spring)'),
      }),
    },
    async (args) =>
      userText(`I want to accept PayRam payments${args.framework ? ` in my ${args.framework} app` : ''}. Please:
1. Look at my project to confirm the framework.
2. Generate a server-side payment route (generate_payment_route_snippet or the framework snippet): create the payment with the project API key and redirect the customer to the returned url.
3. Generate the webhook handler (generate_webhook_handler). Deliveries carry ${WEBHOOK.signature}. ${WEBHOOK.verify} ${WEBHOOK.amounts} ${WEBHOOK.ping}
4. Explain how to test it end to end on testnet (append &test=true to preview checkout).
Keep the API key server-side only.`),
  );

  server.registerPrompt(
    'troubleshoot-payment',
    {
      title: 'Troubleshoot a payment',
      description: 'A customer paid but the order is not marked paid, or checkout fails',
      argsSchema: z.object({
        issue: z.string().optional().describe('What is happening'),
        server: z.string().optional().describe('PayRam URL, e.g. https://pay.example.com'),
      }),
    },
    async (args) =>
      userText(`Help me troubleshoot a PayRam payment problem.${args.issue ? ` Issue: ${args.issue}.` : ''}
1. Call payram_troubleshoot with what is happening (and the exact error text if there is one), then payram_doctor${args.server ? ` with baseUrl ${args.server}` : ' with my PayRam URL (ask me for it)'}.
2. Follow payram_ops_playbook "stuck_payment" (and "node_sync", "workers", "webhooks" as it suggests), running the calls with my credentials on my machine.
3. Tell me the most likely cause and the fix. Do not create new payment links for the affected customer while investigating, and do not restart anything without my OK.`),
  );

  server.registerPrompt(
    'daily-ops',
    {
      title: 'Daily PayRam check',
      description: 'Run the read-only daily check and report what needs attention',
      argsSchema: z.object({
        server: z.string().optional().describe('PayRam URL, e.g. https://pay.example.com'),
      }),
    },
    async (args) =>
      userText(
        `Run my daily PayRam check${args.server ? ` for ${args.server}` : ''}: call payram_doctor with the URL, then run payram_ops_playbook "daily_check" with my credentials. Report only what needs attention, most urgent first, with the next step for each. Do not change anything without asking me.`,
      ),
  );

  logger.debug('Prompts registered successfully');
};
