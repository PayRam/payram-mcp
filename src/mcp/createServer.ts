import { McpServer } from '@modelcontextprotocol/server';
import { registerTools } from '../tools/index.js';
import { registerPrompts } from '../prompts/index.js';
import { registerResources } from '../resources/index.js';
import { MCP_SERVER_VERSION } from '../generated/buildInfo.js';
import { isHosted } from '../config/runtime.js';
import { LINKS } from '../facts/payram.js';

export const SERVER_NAME = 'payram-helper';

const HOSTED_NOTE = `This is the hosted server (mcp.payram.com). It never holds merchant credentials: for operations on a merchant's PayRam, use payram_ops_playbook and run the calls yourself with credentials that stay on your machine.`;

const LOCAL_NOTE = `This is a local instance. Data tools use PAYRAM_* credentials from this server's environment when present.`;

export const buildInstructions = (): string =>
  `PayRam is a self-hosted stablecoin and crypto payment gateway: the merchant runs it on their own server, so there is no account that can be locked, no funds that can be frozen, no customer data shared with anyone, and no deposit keys on the server (smart contracts move funds to the merchant's cold wallet).

Start here:
- Install on a VPS or computer: payram_setup_plan (personalised, step by step).
- Check a running server: payram_doctor with its public URL.
- One-off admin tasks (SSL, domain, upgrade, backup, chains, Smart Bridge, Shopify, WooCommerce): payram_runbook.
- Daily operations and troubleshooting via the PayRam API: payram_ops_playbook (start with task "connect").
- Add payments to an app: generate_payment_route_snippet, generate_webhook_handler, scaffold_payram_app.

Steps that spend money, choose the cold wallet or fees, create or approve payouts, change the site URL, upgrade, or reset an install need the human's explicit OK.

${isHosted() ? HOSTED_NOTE : LOCAL_NOTE}`;

/** Build one server instance. Called once per request (stateless). */
export const createPayramMcpServer = (): McpServer => {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: 'PayRam',
      version: MCP_SERVER_VERSION,
      description:
        'Install, configure, operate and integrate self-hosted PayRam crypto/stablecoin payment gateways.',
      websiteUrl: LINKS.site,
      icons: [{ src: `${LINKS.site}/favicon.png`, mimeType: 'image/png' }],
    },
    {
      instructions: buildInstructions(),
      // The catalog is static per deployment, so 2026-era clients may cache
      // list results for a while (public: nothing tenant-specific in them).
      cacheHints: {
        'tools/list': { ttlMs: 300_000, cacheScope: 'public' },
        'prompts/list': { ttlMs: 300_000, cacheScope: 'public' },
        'resources/list': { ttlMs: 300_000, cacheScope: 'public' },
        'resources/templates/list': { ttlMs: 300_000, cacheScope: 'public' },
        'server/discover': { ttlMs: 300_000, cacheScope: 'public' },
      },
    },
  );

  registerTools(server);
  registerPrompts(server);
  registerResources(server);
  return server;
};
