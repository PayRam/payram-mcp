/**
 * PayRam product facts — the ONE place setup, runbook and ops-playbook
 * content reads product truths from, so a change in core or the installer
 * is a one-line edit here instead of a hunt through prose.
 *
 * Verified against payram-core v3.8.1, payram-frontend v1.8.0 and
 * payram-scripts main (2026-09-15). Evidence: the 2026-09-16 MCP audit.
 * When core or the installer changes, update this file first.
 */

export const CORE_VERSION_VERIFIED = '3.8.1';

export const LINKS = {
  docs: 'https://docs.payram.com',
  releases: 'https://payram.com/releases',
  upgradePolicy:
    'https://raw.githubusercontent.com/PayRam/payram-scripts/main/updater-configs/upgrade-policy.json',
  scriptsRepo: 'https://github.com/PayRam/payram-scripts',
  community: 'https://t.me/PayRamChat',
  site: 'https://mcp.payram.com',
  mcp: 'https://mcp.payram.com/mcp',
} as const;

/** Headless agent-CLI subcommands that actually exist in setup_payram_agents.sh. */
export const AGENT_CLI_COMMANDS = [
  'status',
  'setup',
  'signin',
  'ensure-config',
  'setup-mode',
  'ensure-operator-config',
  'ensure-api-key',
  'ensure-wallet',
  'deploy-scw',
  'deploy-scw-flow',
  'create-payment-link',
  'start-mcp-server',
  'reset-local',
  'menu',
  'run',
] as const;

type AgentCliCommand = (typeof AGENT_CLI_COMMANDS)[number];

/**
 * Install commands. `curl … | bash` is deliberately absent: the installer
 * needs a terminal (TTY) for its one-time DB/SSL/port questions, and a
 * piped script has none, so a fresh install exits.
 */
export const INSTALL = {
  installer: 'bash <(curl -fsSL https://payram.com/setup_payram.sh)',
  installerAsRoot: "sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh)'",
  agentCli: 'bash <(curl -fsSL https://payram.com/setup_payram_agents.sh)',
  /** Build a headless agent-CLI invocation, e.g. agentCmd('signin'). Typed so only real commands compile. */
  agentCmd: (args: AgentCliCommand | `${AgentCliCommand} ${string}`) =>
    `bash <(curl -fsSL https://payram.com/setup_payram_agents.sh) ${args}`,
  update: "sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh) --update'",
  updateToTag: (tag: string) =>
    `sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh) --update --tag=${tag}'`,
  restart: "sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh) --restart'",
  sslMenu:
    "sudo bash -c 'bash <(curl -fsSL https://payram.com/setup_payram.sh)'   # then choose 5) Update SSL Configuration",
  shopifyConnector:
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/PayRam/payram-shopify/main/setup_payram_shopify.sh)"',
  ttyRule:
    'A fresh install asks one-time questions (database, SSL, port) and needs an interactive terminal once. Run it in a real TTY (an SSH session, or `ssh -t`). Everything after the install is headless.',
} as const;

export const REQUIREMENTS = {
  server: '2 CPU cores, 4 GB RAM, 50 GB SSD',
  os: 'Ubuntu 22.04+ recommended (Debian, RHEL family, Fedora, Arch, Alpine also supported; macOS for testing only)',
  diskFloor: 'The installer refuses to run with less than 5 GB free and recommends 10 GB+ free.',
  externalDb: 'Optional external Postgres: 1 vCPU, 1 GB RAM, 50 GB SSD',
} as const;

export const NETWORK = {
  /** The installer/agent CLI default when no flag is given. */
  installerDefault: 'mainnet',
  flags: { testnet: '--testnet', mainnet: '--mainnet' },
  switchRule:
    'The network is fixed at install time. There is no in-place testnet→mainnet switch: use a new server for mainnet (recommended) or reset and reinstall (deletes all data).',
  testModeRule:
    'Checkout test mode is on by default on testnet; on any install you can append &test=true to a checkout URL to preview the payment flow.',
} as const;

const CONTAINER_NAME = 'payram';

export const CONTAINER = {
  name: CONTAINER_NAME,
  image: 'payramapp/payram',
  publicPorts:
    'Fresh installs publish only port 80 (HTTP), plus 443 when SSL is configured. The bundled nginx serves the dashboard, checkout and API on the same origin.',
  firewall: `Open inbound 80 and 443 only (plus 22 for SSH). Never open 5432 (Postgres), 8080 or 8443. Legacy installs may still publish 5432/8080/8443 — check with \`docker port ${CONTAINER_NAME}\`.`,
  apiBase:
    'The API is same-origin with the dashboard: https://<your-domain>/api/v1/... (or http://<server-ip>/api/v1/... before SSL). On the server itself: http://localhost/api/v1/...',
  logs: {
    app: '~/.payram-core/log/ (payram.log, deposit_processor.log, webhook_processor.log, eth_processor.log, …)',
    supervisor: '~/.payram-core/log/supervisord/<program>.{out,err}.log',
    nginx: '~/.payram-core/log/nginx/',
    installer: '/tmp/payram-setup.log',
    note: `\`docker logs ${CONTAINER_NAME}\` shows only container startup/supervisord output, not backend request errors.`,
  },
  config: '~/.payraminfo/config.env (chmod 600: image tag, network, DB, SSL, retained ports)',
  aesKey:
    '~/.payraminfo/aes/ — back this up together with the database; without it the encrypted hot-wallet key is unrecoverable.',
  agentState:
    '~/.payraminfo/ also holds headless-tokens.env (JWT), root-credentials.env, merchant-api-key.env, headless-wallet-secret.txt (deployer mnemonic).',
  data: '~/.payram-core/db/postgres (Linux bind mount)',
  supervisorctl: `docker exec ${CONTAINER_NAME} supervisorctl status`,
} as const;

/** Workers the API can restart (POST /api/v1/system/workers/{name}/restart). */
export const RESTARTABLE_WORKERS = [
  'eth-listener',
  'btc-listener',
  'trx-listener',
  'base-listener',
  'polygon-listener',
  'deposit-processor',
  'account-processor',
  'webhook-processor',
  'email-processor',
  'erc20-sweep-approval-processor',
  'broadcast-scw-deposit-wallet-processor',
] as const;

/**
 * Program states that look alarming but are known to be harmless on current
 * images (redis-server daemonizes, so supervisord reports it FATAL).
 */
export const KNOWN_FALSE_ALARMS: Readonly<Record<string, readonly string[]>> = {
  'redis-server': ['FATAL'],
};

/** Is a supervisord program really down (not RUNNING and not a known false alarm)? */
export const isProgramDown = (name: string, state: string): boolean => {
  const s = String(state).toUpperCase();
  return s !== 'RUNNING' && !KNOWN_FALSE_ALARMS[name]?.includes(s);
};

/** The same rule as a jq condition over a {key: name, value: state} entry. */
export const JQ_PROGRAM_DOWN = `.value != "RUNNING" and (${Object.entries(KNOWN_FALSE_ALARMS)
  .flatMap(([name, states]) => states.map((st) => `(.key == "${name}" and .value == "${st}")`))
  .join(' or ')} | not)`;

export const KNOWN_FALSE_ALARMS_NOTE = Object.entries(KNOWN_FALSE_ALARMS)
  .map(([name, states]) => `${name} ${states.join('/')}`)
  .join(', ');

export const CHAIN_LISTENER: Record<string, string> = {
  ETH: 'eth-listener',
  BTC: 'btc-listener',
  TRX: 'trx-listener',
  BASE: 'base-listener',
  POLYGON: 'polygon-listener',
};

/**
 * Native chains with their own listener. Codes are UPPERCASE everywhere in
 * the API. `tokens` is what the chain accepts; payouts support the same pairs
 * (BTC payouts are not supported).
 */
export const NATIVE_CHAINS = [
  {
    code: 'ETH',
    name: 'Ethereum',
    tokens: 'ETH, USDC, USDT, CBBTC, PYUSD',
    wallet: 'smart-contract wallet (gas)',
    payouts: true,
  },
  {
    code: 'BASE',
    name: 'Base',
    tokens: 'ETH, USDC, CBBTC',
    wallet: 'smart-contract wallet (gas)',
    payouts: true,
  },
  {
    code: 'POLYGON',
    name: 'Polygon',
    tokens: 'POL, USDC, USDT',
    wallet: 'smart-contract wallet (gas)',
    payouts: true,
  },
  {
    code: 'TRX',
    name: 'Tron',
    tokens: 'TRX, USDT',
    wallet: 'smart-contract wallet (gas)',
    payouts: true,
  },
  { code: 'BTC', name: 'Bitcoin', tokens: 'BTC', wallet: 'xpub wallet (no gas)', payouts: false },
] as const;

/**
 * Smart Bridge rails: the payer pays on another network, the merchant
 * settles as USDC on Base. No node to run.
 */
export const SMART_BRIDGE = {
  rails: [
    { origin: 'Solana', since: '3.6.0' },
    { origin: 'Bitcoin', since: '3.7.0' },
    { origin: 'Tron (USDT)', since: '3.7.0' },
    { origin: 'BNB Chain (USDC, USDT, BNB)', since: '3.8.0' },
  ],
  settlesAs: 'USDC on Base',
  requires:
    'The project accepts USDC on Base and has a Base deposit wallet. Rails are mainnet-only in practice.',
  defaults:
    'Rails default ON (since 3.6). Since 3.7, an enabled rail replaces the native Bitcoin and native Tron-USDT options in the checkout picker (native TRX stays) unless the link is locked to one asset.',
  merchantImpact:
    'A merchant who wants to receive native BTC or native Tron USDT should review Payment options and switch the rail off. Bridged payments appear as ordinary Base/USDC payments in the API.',
  api: 'GET/PUT /api/v1/project/{projectId}/payment-options (per project), GET/PUT /api/v1/payment-options (global)',
} as const;

/** Setup mode (the role of this install). */
export const SETUP_MODE = {
  merchant: 'Take payments for your own business (default).',
  operator:
    'Run PayRam as a platform for other merchants and earn a fee on their volume. Must be chosen before the first project; the role locks once role-specific data exists.',
  operatorFees:
    'Since 3.8 a merchant deposit wallet keeps the fee terms it was deployed with; changing a live rate is an on-chain change signed by the operator, not a dashboard edit.',
} as const;

/** Credential matrix for direct API calls. */
export const AUTH = {
  jwt: 'Dashboard login token: POST /api/v1/signin {email,password} → accessToken (short-lived) + refreshToken. Send as `Authorization: Bearer <accessToken>`. Needed for admin, ops and analytics routes.',
  refresh:
    'POST /api/v1/refresh {refreshToken} → new pair. The refresh token rotates: always store the new one.',
  apiKey:
    'Project API key: send as `API-Key: <key>`. Used for server-to-server payment APIs (create payment, payment lookup, merchant payouts). Keys can create payouts — keep them server-side, never in browser code, never in a chat.',
  public: 'No credential: GET /api/v1/health, GET /api/v1/version, GET /api/v1/currencies.',
  headlessFiles:
    'On an agent-CLI install: JWT in ~/.payraminfo/headless-tokens.env (refresh with `signin`), API key in ~/.payraminfo/merchant-api-key.env.',
} as const;

/** Webhook delivery contract (PayRam → the merchant's server). */
export const WEBHOOK = {
  signature:
    'X-Payram-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the project API key>',
  signingKey:
    "the project's newest active API key (there is no separate webhook secret in the dashboard)",
  legacyHeader: 'API-KEY: <project API key>',
  verify:
    'Verify the HMAC over the raw request bytes with a constant-time compare, then re-check the payment via GET /api/v1/payment/reference/{id} before fulfilling.',
  amounts: 'Amounts are JSON strings (decimals); currency is a crypto ticker such as USDT.',
  ping: 'Before payout webhooks PayRam sends an unsigned ping (header X-Webhook-Test: true); answer 2xx.',
  retries: '30m, 1h, 2h, 4h, 8h, 24h, 48h',
  cancelled: 'CANCELLED is not delivered by webhook; poll the reference endpoint.',
} as const;

/** Sweep/consolidation status codes core reports on unswept-balance rows. */
export const SWEEP_STATUS = {
  LOW_NATIVE_BALANCE:
    'Hot wallet lacks native gas on this chain. Top it up (see lastSweepError.hotWalletAddress / actionHint).',
  DEPOSIT_NOT_DEPLOYED_LOW_GAS:
    'Deposit contract not yet deployed and not enough gas to deploy it. Top up the hot wallet.',
  GAS_TOO_HIGH: 'Network gas is high; core retries automatically.',
  HOT_WALLET_MISSING: 'No hot wallet for this network. Add one in the dashboard.',
  FUND_SWEEPER_NOT_DEPLOYED:
    'The sweeper contract is not deployed on this chain. Deploy the smart-contract wallet for it.',
  DEPOSIT_NOT_DEPLOYED_FUND_SWEEPER_MISSING:
    'No sweeper contract for this chain; deposits cannot be swept yet.',
  NODE_CONNECTION_FAILED:
    'Temporary node/infra problem; core retries automatically. Check node status if it persists.',
} as const;

/** Sweep statuses that mean the hot wallet needs native gas. */
export const SWEEP_GAS_STATUSES: readonly string[] = [
  'LOW_NATIVE_BALANCE',
  'DEPOSIT_NOT_DEPLOYED_LOW_GAS',
] satisfies (keyof typeof SWEEP_STATUS)[];

export const DASHBOARD_PAGES = {
  siteUrl: 'Settings → Site URL',
  updateManager: 'Settings → Update Manager',
  paymentOptions: 'Project → Payment options',
  apiKeys: 'Project → API keys',
  webhooks: 'Project → Webhooks',
} as const;

/** Things an agent must never do on its own (human-only decisions). */
export const HUMAN_ONLY = [
  'Choosing or changing the cold-wallet (fund collector) address',
  'Spending real money (mainnet gas, mainnet deploys) without explicit consent',
  'Creating or approving payouts',
  'Changing fees or fee collectors (operator mode)',
  'Setting the Site URL (root-only; must be done from the public domain)',
  'Running upgrades',
  'Resetting an install (`reset-local`, `--reset`) — this destroys the database, AES key and wallet secrets',
] as const;
