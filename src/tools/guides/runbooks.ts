import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { safeHandler } from '../common/errors.js';
import { textContent } from '../common/content.js';
import { WHO_LABEL, renderStepLines } from './render.js';
import {
  CONTAINER,
  CORE_VERSION_VERIFIED,
  DASHBOARD_PAGES,
  INSTALL,
  LINKS,
  NETWORK,
  SETUP_MODE,
  SMART_BRIDGE,
  WEBHOOK,
} from '../../facts/payram.js';

/**
 * payram_runbook — step-by-step procedures for one-off admin tasks on a
 * running PayRam (SSL, domain, upgrades, backups, chains, rails, stores).
 * Each step says who runs it; steps that change money flows, ownership or
 * data carry a gate the agent must not pass without the human.
 */

export const RUNBOOK_TASKS = [
  'set_site_url',
  'change_domain',
  'ssl_setup',
  'ssl_renewal_fix',
  'firewall_ports',
  'upgrade',
  'backup',
  'restore',
  'add_chain',
  'smart_bridge',
  'mainnet_cutover',
  'operator_setup',
  'rotate_api_key',
  'reset_test_install',
  'shopify_connector',
  'woocommerce_plugin',
  'secure_analytics_mcp',
] as const;

export type RunbookTask = (typeof RUNBOOK_TASKS)[number];

const runbookSchema = z.object({
  task: z.enum(RUNBOOK_TASKS),
  title: z.string(),
  when: z.string(),
  steps: z.array(
    z.object({
      who: z.enum(['agent_shell', 'human', 'human_dashboard']),
      do: z.string(),
      commands: z.string().optional(),
      gate: z.string().optional(),
    }),
  ),
  verify: z.array(z.string()),
  warnings: z.array(z.string()),
});

type Runbook = z.infer<typeof runbookSchema>;

const RUNBOOKS: Record<RunbookTask, Omit<Runbook, 'task'>> = {
  set_site_url: {
    title: 'Set the public site URL',
    when: 'Payment links, emails or checkout show localhost/an IP/the old domain.',
    steps: [
      {
        who: 'human_dashboard',
        do: `Open the dashboard on the PUBLIC URL (e.g. https://pay.example.com), sign in as root, open ${DASHBOARD_PAGES.siteUrl} and Save.`,
        gate: 'Root-only; the host is taken from the browser request, so it must be done on the public domain.',
      },
      {
        who: 'agent_shell',
        do: 'Confirm the stored value.',
        commands: 'payram_ops_playbook { "task": "site_url" }',
      },
    ],
    verify: ['A new payment link starts with the public URL.'],
    warnings: [
      'Do not "fix" it by calling the API through localhost: that stores localhost again.',
    ],
  },

  change_domain: {
    title: 'Move PayRam to a new domain',
    when: 'Rebranding, or moving from an IP to a domain.',
    steps: [
      {
        who: 'human',
        do: 'Point the new hostname (A/AAAA record) at the server.',
        commands: 'dig +short <new-domain>',
      },
      {
        who: 'agent_shell',
        do: 'Re-run the installer and choose "Update SSL Configuration" for the new domain (stops PayRam briefly, issues the certificate, recreates the container).',
        commands: INSTALL.sslMenu,
        gate: 'Brief downtime; schedule with the human.',
      },
      {
        who: 'human_dashboard',
        do: `Open https://<new-domain>, sign in as root, save ${DASHBOARD_PAGES.siteUrl}.`,
      },
      {
        who: 'human',
        do: "Update every integration that stores the old URL: shop plugins/connector settings, your app's PAYRAM_URL, webhook consumers that check the origin.",
      },
    ],
    verify: [
      'payram_doctor on the new URL is healthy and the certificate is valid.',
      'A new payment link uses the new domain.',
    ],
    warnings: [
      'Payment links already sent keep the old host; keep the old domain redirecting for a while.',
    ],
  },

  ssl_setup: {
    title: 'Add HTTPS',
    when: 'The gateway runs on plain HTTP.',
    steps: [
      {
        who: 'human',
        do: 'Point the domain at the server and make sure ports 80 and 443 are open.',
      },
      {
        who: 'agent_shell',
        do: "Run the installer menu and choose 5) Update SSL Configuration. Options: Let's Encrypt (automatic), your own certificate (/etc/letsencrypt/live/<domain>/fullchain.pem + privkey.pem), or an external proxy (Cloudflare etc.) that forwards to http://<server>:80 with X-Forwarded-Proto: https.",
        commands: INSTALL.sslMenu,
        gate: 'Brief downtime while the container is recreated.',
      },
      {
        who: 'human_dashboard',
        do: `Re-save ${DASHBOARD_PAGES.siteUrl} from https://<domain> so links use https.`,
      },
    ],
    verify: [
      'curl -sI https://<domain>/api/v1/health returns 200',
      'payram_doctor reports the certificate expiry',
    ],
    warnings: [
      'With Let\'s Encrypt, apply "ssl_renewal_fix" right away or the certificate lapses after ~90 days.',
    ],
  },

  ssl_renewal_fix: {
    title: "Make Let's Encrypt renewal work",
    when: "Certificates were issued by the installer with Let's Encrypt (standalone mode).",
    steps: [
      {
        who: 'agent_shell',
        do: 'The renewal cron runs `certbot renew` while PayRam holds port 80, so the standalone challenge cannot bind. Add hooks that free the port during renewal.',
        commands: `# certbot runs every script in these directories around each renewal
printf '#!/bin/sh\\ndocker stop ${CONTAINER.name}\\n' | sudo tee /etc/letsencrypt/renewal-hooks/pre/payram-stop.sh
printf '#!/bin/sh\\ndocker start ${CONTAINER.name}\\n' | sudo tee /etc/letsencrypt/renewal-hooks/post/payram-start.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/pre/payram-stop.sh /etc/letsencrypt/renewal-hooks/post/payram-start.sh`,
        gate: "The next step stops PayRam for a few seconds; run it in a quiet period with the human's OK.",
      },
      {
        who: 'agent_shell',
        do: 'Test renewal end to end.',
        commands: 'sudo certbot renew --dry-run',
      },
    ],
    verify: [
      'The dry run reports success.',
      'curl -s http://localhost/api/v1/health is ok again afterwards.',
      'cat /etc/cron.d/payram-certbot-renewal still runs certbot renew daily.',
    ],
    warnings: [
      'Renewal now causes a few seconds of downtime once every ~60 days. A reverse proxy or DNS-01 challenge avoids that; ask the human if downtime is unacceptable.',
    ],
  },

  firewall_ports: {
    title: 'Close everything except 80/443 (and SSH)',
    when: 'Hardening, or on installs created before mid-2026 that may still publish 5432/8080/8443.',
    steps: [
      {
        who: 'agent_shell',
        do: 'List what the container publishes.',
        commands: `docker port ${CONTAINER.name}`,
      },
      {
        who: 'agent_shell',
        do: 'If 5432, 8080 or 8443 appear, block them. Docker-published ports bypass ufw, so filter them in the DOCKER-USER chain (and in the cloud firewall).',
        commands: `for p in 5432 8080 8443; do sudo iptables -I DOCKER-USER -p tcp --dport $p -j DROP; done
sudo iptables -L DOCKER-USER -n --line-numbers
# persist (Debian/Ubuntu): sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save`,
        gate: 'Changing firewall rules can cut access; confirm the human is not relying on those ports.',
      },
      {
        who: 'human',
        do: 'Mirror the rule in the cloud provider firewall: inbound 22, 80, 443 only.',
      },
      {
        who: 'human',
        do: 'If Postgres (5432) was ever reachable from the internet, rotate the database password and review access; legacy installs use the default payram/payram123.',
      },
    ],
    verify: ['From another machine: nc -zv <server> 5432 8080 8443 all fail; 80/443 succeed.'],
    warnings: [CONTAINER.firewall],
  },

  upgrade: {
    title: 'Upgrade PayRam',
    when: 'payram_ops_playbook "version_check" shows a newer version.',
    steps: [
      {
        who: 'agent_shell',
        do: 'Check current vs latest and any manual breakpoints.',
        commands: `curl -s http://localhost/api/v1/version\ncurl -s ${LINKS.upgradePolicy} | jq '{latest, breakpoints}'`,
      },
      { who: 'agent_shell', do: 'Back up first.', commands: 'payram_runbook { "task": "backup" }' },
      {
        who: 'human',
        do: `Read the release notes (${LINKS.releases}) and approve the upgrade.`,
        gate: 'Upgrades are a human decision.',
      },
      {
        who: 'agent_shell',
        do: 'Upgrade from the CLI (keeps data and ports), or use the dashboard.',
        commands: `${INSTALL.update}\n# specific version:\n${INSTALL.updateToTag(CORE_VERSION_VERIFIED)}`,
      },
      { who: 'human_dashboard', do: `Alternative: ${DASHBOARD_PAGES.updateManager}.` },
    ],
    verify: [
      '/api/v1/version shows the new version',
      '/api/v1/health status ok',
      'payram_ops_playbook "workers" all RUNNING',
    ],
    warnings: [
      'After upgrading to 3.7+, review Payment options: Smart Bridge rails can replace native BTC / Tron-USDT at checkout (task "smart_bridge").',
      'The update keeps previously published ports; run "firewall_ports" if the install is old.',
    ],
  },

  backup: {
    title: 'Back up PayRam (database + keys)',
    when: 'Before upgrades and on a schedule (daily).',
    steps: [
      {
        who: 'agent_shell',
        do: 'Dump the database and archive the key/config folder. The AES key must be backed up together with the database.',
        commands: `B=~/payram-backup-$(date +%F); mkdir -p "$B" && chmod 700 "$B"
docker exec ${CONTAINER.name} pg_dump -U payram payram > "$B/payram.sql"   # containerized DB (default)
sudo tar czf "$B/payraminfo.tgz" -C ~ .payraminfo                      # AES key, config.env, agent secrets
ls -lh "$B"`,
      },
      {
        who: 'human',
        do: 'Move the backup off the server, encrypted (it contains the AES key, credentials and wallet secrets).',
        gate: "Choosing where secrets are stored is the human's call.",
      },
    ],
    verify: ['payram.sql is non-empty and starts with a PostgreSQL dump header.'],
    warnings: [
      'External database? Back it up with your provider instead of pg_dump in the container.',
      CONTAINER.aesKey,
    ],
  },

  restore: {
    title: 'Restore from backup (outline — rehearse on a scratch server first)',
    when: 'Server loss or migration.',
    steps: [
      {
        who: 'agent_shell',
        do: 'On a new server install the SAME PayRam version and network as the backup.',
        commands: `${INSTALL.installer} ${NETWORK.flags.testnet}   # or --mainnet, and --tag=<same version>`,
      },
      {
        who: 'agent_shell',
        do: 'Restore ~/.payraminfo (AES key, config.env) from the archive, then restore the database dump into the container and restart.',
        commands: `sudo tar xzf payraminfo.tgz -C ~
docker exec -i ${CONTAINER.name} psql -U payram payram < payram.sql
${INSTALL.restart}`,
        gate: "Overwrites the target database. Only on an empty, freshly installed server, with the human's OK.",
      },
    ],
    verify: [
      'Dashboard login works with the old credentials',
      'Wallets and projects are present',
      'payram_ops_playbook "daily_check" is clean',
    ],
    warnings: [
      'The AES key in ~/.payraminfo must be the one that encrypted the database; a mismatch makes the hot-wallet key unusable.',
      'Ask in ' + LINKS.community + ' before restoring a production install for the first time.',
    ],
  },

  add_chain: {
    title: 'Accept payments on another chain',
    when: 'You want ETH, Polygon, Tron or BTC in addition to Base.',
    steps: [
      {
        who: 'agent_shell',
        do: 'EVM chains: deploy the smart-contract deposit wallet on that chain (the deployer needs gas on that chain).',
        commands: `PAYRAM_BLOCKCHAIN_CODE=ETH ${INSTALL.agentCmd('deploy-scw')}\nPAYRAM_BLOCKCHAIN_CODE=POLYGON ${INSTALL.agentCmd('deploy-scw')}`,
        gate: 'Spends gas; on mainnet the human must approve and PAYRAM_FUND_COLLECTOR/PAYRAM_ACCEPT_MAINNET_COSTS must be set.',
      },
      {
        who: 'agent_shell',
        do: 'Bitcoin: create the xpub wallet (no gas).',
        commands: INSTALL.agentCmd('ensure-wallet'),
      },
      {
        who: 'human_dashboard',
        do: 'Tron and anything else: add the wallet in the dashboard (Wallets).',
      },
      { who: 'human_dashboard', do: 'Enable the currencies for the project.' },
    ],
    verify: [
      'payram_ops_playbook "payment_options" shows no unmet requirement for the chain',
      'payram_ops_playbook "node_sync" shows the listener keeping up',
    ],
    warnings: [
      `Or skip running a node: Smart Bridge rails (${SMART_BRIDGE.rails.map((r) => r.origin).join(', ')}) take payments on other networks and settle as ${SMART_BRIDGE.settlesAs}.`,
      'Keep the deployer mnemonic (~/.payraminfo/headless-wallet-secret.txt) backed up: it is needed for every new chain.',
    ],
  },

  smart_bridge: {
    title: 'Review or change Smart Bridge rails',
    when: 'After upgrading to 3.6+/3.7+, or when a merchant wants (or does not want) payments on Solana, BNB, bridged BTC or bridged Tron.',
    steps: [
      {
        who: 'agent_shell',
        do: 'Show the current options and what is missing.',
        commands: 'payram_ops_playbook { "task": "payment_options" }',
      },
      {
        who: 'human',
        do: `Decide: ${SMART_BRIDGE.merchantImpact}`,
        gate: 'Changes what asset the merchant receives.',
      },
      { who: 'human_dashboard', do: `${DASHBOARD_PAGES.paymentOptions}: switch rails on/off.` },
    ],
    verify: ['Open a test checkout (&test=true) and check which options appear.'],
    warnings: [
      SMART_BRIDGE.defaults,
      SMART_BRIDGE.requires,
      'Rails depend on a third-party bridge service; payer details needed for the bridge leave the server.',
    ],
  },

  mainnet_cutover: {
    title: 'Go live on mainnet',
    when: 'Testing on testnet is done.',
    steps: [
      {
        who: 'human',
        do: 'Provision a NEW server for mainnet (recommended). ' + NETWORK.switchRule,
      },
      {
        who: 'human',
        do: 'Decide the cold wallet (sweep destination) and approve ~$10 of gas.',
        gate: 'Ownership and real-money decisions.',
      },
      {
        who: 'agent_shell',
        do: 'Follow payram_setup_plan with network "mainnet".',
        commands: 'payram_setup_plan { "network": "mainnet", "domain": "pay.example.com" }',
      },
    ],
    verify: ['A small real payment arrives and sweeps to the cold wallet.'],
    warnings: [
      'Do not "re-run with --mainnet" on a running testnet install: it does not reinstall and a contract deploy can target the wrong network.',
    ],
  },

  operator_setup: {
    title: 'Run PayRam as an operator (platform for other merchants)',
    when: 'Before the first project exists.',
    steps: [
      {
        who: 'human',
        do: 'Decide the fee collector addresses (per chain family) and the fee rate.',
        gate: 'Business and ownership decisions.',
      },
      {
        who: 'agent_shell',
        do: 'Set the role and apply fee config.',
        commands: `export PAYRAM_OPERATOR_EVM_FEE_COLLECTOR=0x...\nexport PAYRAM_OPERATOR_BTC_FEE_COLLECTOR=bc1...\nexport PAYRAM_OPERATOR_FEE_BPS=<bps>\n${INSTALL.agentCmd('setup-mode operator')}\n${INSTALL.agentCmd('ensure-operator-config')}`,
      },
      {
        who: 'human_dashboard',
        do: 'Onboard merchants (projects) and deploy their deposit wallets from the dashboard.',
      },
    ],
    verify: ['setup-mode shows operator', 'Operator dashboard loads'],
    warnings: [SETUP_MODE.operator, SETUP_MODE.operatorFees],
  },

  rotate_api_key: {
    title: 'Rotate a project API key',
    when: 'A key leaked (e.g. was embedded in a web page) or on a schedule.',
    steps: [
      { who: 'human_dashboard', do: `${DASHBOARD_PAGES.apiKeys}: create a new key.` },
      {
        who: 'human',
        do: 'Update every integration (servers, shop plugins, webhook receivers) to the new key.',
      },
      {
        who: 'human_dashboard',
        do: 'Deactivate the old key.',
        gate: 'Integrations still on the old key stop working.',
      },
    ],
    verify: [
      'A test payment link can be created with the new key',
      'The shop/app still accepts webhooks',
    ],
    warnings: [
      "Webhooks are signed with the project's NEWEST active key, so receivers must switch at the same time as the new key is created.",
      'Project keys can create payouts: never place one in browser code.',
    ],
  },

  reset_test_install: {
    title: 'Wipe a TEST install and start over',
    when: 'Only on a disposable testnet server.',
    steps: [
      {
        who: 'agent_shell',
        do: 'Back up anything you may need.',
        commands: 'payram_runbook { "task": "backup" }',
      },
      {
        who: 'human',
        do: 'Confirm this is a test server with nothing of value.',
        gate: 'Irreversible: deletes the database, the AES key, wallet secrets and credentials.',
      },
      {
        who: 'agent_shell',
        do: 'Reset (asks for confirmation — do not add -y).',
        commands: `${INSTALL.agentCmd('reset-local')}\n# or: ${INSTALL.installer} --reset   (type DELETE when asked)`,
      },
    ],
    verify: ['docker ps shows no payram container (or a fresh one after reinstall)'],
    warnings: ['Never on mainnet or on a server holding real funds or data.'],
  },

  shopify_connector: {
    title: 'Connect a Shopify store',
    when: 'A merchant wants crypto checkout on Shopify.',
    steps: [
      {
        who: 'human',
        do: 'Prerequisites: a Shopify Partner account (browser login), Docker on a server, a public HTTPS URL for the connector (TLS in front of port 2798), and PayRam reachable at a public HTTPS hostname (no IP, no port).',
      },
      {
        who: 'agent_shell',
        do: 'Run the connector installer in a real terminal (it logs into Shopify via a device code).',
        commands: INSTALL.shopifyConnector,
        gate: 'The human completes the Shopify login and store selection.',
      },
      {
        who: 'agent_shell',
        do: 'Back up the generated ENCRYPTION_KEY (in the install directory .env); losing it makes stored API keys unreadable. Also set PAYMENT_LINK_SECRET in that .env for production, then restart the container.',
      },
      {
        who: 'human',
        do: 'Open https://<connector-url>/auth?shop=<store>.myshopify.com and approve the app.',
      },
      {
        who: 'human_dashboard',
        do: 'Shopify Admin → Apps → PayRam → Settings: PayRam Base URL (https://pay.example.com) + Project API key → Save → Test.',
      },
      {
        who: 'human_dashboard',
        do: 'Shopify Settings → Payments → add a manual payment method (e.g. "Pay with Crypto"). Checkout → Customize → Thank you page → add the PayRam block.',
      },
      {
        who: 'human_dashboard',
        do: `In PayRam (${DASHBOARD_PAGES.webhooks}, same project as the key): add the webhook https://<connector-url>/api/payram/webhook. Without it orders are never marked paid.`,
      },
    ],
    verify: [
      'Place a test order with the manual method, pay from the Thank you page, and check the order gets the payram_paid tag.',
      'Probe the webhook route: curl -s -X POST https://<connector-url>/api/payram/webhook -H "Content-Type: application/json" -d "{}" → 400 "Missing reference_id" (no side effects).',
    ],
    warnings: [
      'Before fulfilling, confirm the payment in PayRam (payram_ops_playbook "payment_lookup"): the current connector does not verify webhook signatures, so the order tag alone is not proof of payment.',
      'Keep "auto gift card on overpayment" OFF until the connector verifies webhook signatures.',
      'Fresh installs may lack the gift-card permission (installer scope fix pending); gift-card refunds then fail with 403.',
      'The connector database is SQLite; do not choose Postgres in the installer.',
      'Changing the connector URL requires re-running the installer.',
    ],
  },

  woocommerce_plugin: {
    title: 'Connect a WooCommerce store',
    when: 'A merchant wants crypto checkout on WordPress/WooCommerce.',
    steps: [
      {
        who: 'human',
        do: 'Get the plugin v0.3.0 or newer from https://github.com/PayRam/payram-woocommerce (the older zip lacks payment re-verification hardening). Requires WordPress 6.0+, WooCommerce 6.0+, PHP 7.4+.',
      },
      { who: 'human_dashboard', do: 'WordPress → Plugins → Add New → Upload → Activate.' },
      {
        who: 'human_dashboard',
        do: 'WooCommerce → Settings → Payments → PayRam (Crypto): enable, set PayRam URL (https://pay.example.com — not localhost:8080) and the Project API key. Turn on Debug while testing.',
      },
      {
        who: 'human_dashboard',
        do: `In PayRam (${DASHBOARD_PAGES.webhooks}, same project): add https://<shop>/wp-json/payram/v1/webhook, and set the project success/cancel URL to https://<shop>/?payram_return=1.`,
      },
    ],
    verify: [
      'Place a test order; WooCommerce → Status → Logs (source "payram") shows the webhook accepted and the order becomes Processing/Completed.',
    ],
    warnings: [
      `The plugin requires the signature (${WEBHOOK.signature}); the key is ${WEBHOOK.signingKey}. "invalid HMAC signature" means the plugin has a different key.`,
      'With "Plain" permalinks /wp-json/ is not available; use pretty permalinks.',
      'Do not press the PayRam webhook "Test" button while the endpoint returns 404/405 — it deactivates the webhook.',
    ],
  },

  secure_analytics_mcp: {
    title: 'Check that no local MCP server is exposed',
    when: 'Any agent-CLI install (the flow can start an Analytics MCP server on port 3333).',
    steps: [
      {
        who: 'agent_shell',
        do: 'See whether anything listens on 3333 and on which address.',
        commands: 'sudo ss -ltnp | grep ":3333" || echo "nothing on 3333"',
      },
      {
        who: 'agent_shell',
        do: 'If it listens on 0.0.0.0/[::], stop it and block the port; re-run the agent flow with --skip-mcp-server.',
        commands: `kill "$(cat ~/.payraminfo/mcp-server.pid)" 2>/dev/null
sudo iptables -I INPUT -p tcp --dport 3333 -j DROP`,
        gate: 'If it was reachable from the internet, the human should change the root password.',
      },
    ],
    verify: ['nc -zv <server> 3333 from another machine fails.'],
    warnings: [
      'That server runs with the root dashboard login and has no authentication of its own; it must never be reachable from the network.',
    ],
  },
};

export const getRunbook = (task: RunbookTask): Runbook => ({ task, ...RUNBOOKS[task] });

export const renderRunbook = (rb: Runbook): string => {
  const lines = [`## ${rb.title}`, `When: ${rb.when}`, ''];
  rb.steps.forEach((s, i) =>
    lines.push(
      ...renderStepLines({
        heading: `${i + 1}. [${WHO_LABEL[s.who]}] ${s.do}`,
        gate: s.gate,
        commands: s.commands,
      }),
    ),
  );
  lines.push('', 'Verify:', ...rb.verify.map((v) => `- ${v}`));
  if (rb.warnings.length) lines.push('', 'Watch out:', ...rb.warnings.map((w) => `- ${w}`));
  return lines.join('\n');
};

export const registerRunbookTool = (server: McpServer) => {
  server.registerTool(
    'payram_runbook',
    {
      title: 'PayRam runbooks (one-off admin tasks)',
      description: `Step-by-step procedures for changes to a running PayRam, each step marked agent vs human with hard stops: ${RUNBOOK_TASKS.join(', ')}. Omit task to list them.`,
      inputSchema: z.object({
        task: z.enum(RUNBOOK_TASKS).optional().describe('Which runbook. Omit to list all.'),
      }),
      outputSchema: z.object({
        tasks: z.array(z.object({ task: z.string(), title: z.string() })),
        runbook: runbookSchema.optional(),
      }),
    },
    safeHandler(
      async ({ task }: { task?: RunbookTask }) => {
        const tasks = RUNBOOK_TASKS.map((t) => ({ task: t, title: RUNBOOKS[t].title }));
        if (!task) {
          const text = [
            '# PayRam runbooks',
            ...tasks.map((t) => `- ${t.task} — ${t.title}`),
            '',
            'New install? Use payram_setup_plan. Daily checks and API calls: payram_ops_playbook.',
          ].join('\n');
          return { content: [textContent(text)], structuredContent: { tasks } };
        }
        const runbook = getRunbook(task);
        return {
          content: [textContent(renderRunbook(runbook))],
          structuredContent: { tasks, runbook },
        };
      },
      { toolName: 'payram_runbook' },
    ),
  );
};
