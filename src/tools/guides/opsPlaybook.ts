import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { safeHandler } from '../common/errors.js';
import { textContent } from '../common/content.js';
import {
  AUTH,
  CHAIN_LISTENER,
  CONTAINER,
  DASHBOARD_PAGES,
  INSTALL,
  JQ_PROGRAM_DOWN,
  KNOWN_FALSE_ALARMS_NOTE,
  LINKS,
  RESTARTABLE_WORKERS,
  SMART_BRIDGE,
  SWEEP_STATUS,
  WEBHOOK,
} from '../../facts/payram.js';

/**
 * payram_ops_playbook — daily-ops and troubleshooting recipes the agent
 * runs ITSELF against the merchant's PayRam API.
 *
 * Why recipes instead of live tools on the hosted server: mcp.payram.com
 * must never hold a merchant's credentials (the "PayRam cannot see your
 * data" promise), and core has no scoped read-only key yet. So the hosted
 * MCP teaches the exact call, the credential it needs and how to read the
 * answer; the agent executes it with credentials that never leave its host.
 */

export const OPS_TASKS = [
  'connect',
  'health',
  'version_check',
  'workers',
  'restart_worker',
  'node_sync',
  'site_url',
  'payment_options',
  'unswept_funds',
  'payments_today',
  'payment_lookup',
  'stuck_payment',
  'create_payment_link',
  'payouts',
  'webhooks',
  'logs',
  'daily_check',
] as const;

export type OpsTask = (typeof OPS_TASKS)[number];

const AUTH_LABEL = {
  none: 'none (public)',
  jwt: 'dashboard login (JWT: Authorization: Bearer)',
  jwt_root: 'root dashboard login (JWT)',
  api_key: 'project API key (API-Key header)',
  server_shell: 'shell on the PayRam server',
} as const;

type Auth = keyof typeof AUTH_LABEL;

const recipeSchema = z.object({
  task: z.enum(OPS_TASKS),
  title: z.string(),
  when: z.string(),
  auth: z.enum(Object.keys(AUTH_LABEL) as [Auth, ...Auth[]]),
  safety: z.enum(['read', 'write_needs_confirmation']),
  commands: z.string(),
  interpret: z.array(z.string()),
  pitfalls: z.array(z.string()),
  next: z.array(z.string()),
});

export type OpsRecipe = z.infer<typeof recipeSchema>;

const ENV_HINT =
  'Assumes the variables from task "connect": PAYRAM_URL, PAYRAM_JWT, PAYRAM_API_KEY, PROJECT_ID. Requires curl and jq.';

const H_JWT = '-H "Authorization: Bearer $PAYRAM_JWT"';
const H_KEY = '-H "API-Key: $PAYRAM_API_KEY"';

const RECIPES: Record<OpsTask, Omit<OpsRecipe, 'task'>> = {
  connect: {
    title: 'Set up credentials for direct API calls',
    when: 'Before any other recipe. Credentials stay on your machine; never paste them into chat.',
    auth: 'none',
    safety: 'read',
    commands: `# 1. Base URL: same origin as the dashboard (no :8080).
export PAYRAM_URL="https://pay.example.com"      # on the PayRam server itself: http://localhost

# 2. Dashboard login token (JWT) — needed for ops/admin routes.
#    On an agent-CLI install the saved credentials can be reused:
#      source ~/.payraminfo/root-credentials.env   # provides PAYRAM_EMAIL / PAYRAM_PASSWORD
export PAYRAM_JWT=$(curl -s -X POST "$PAYRAM_URL/api/v1/signin" \\
  -H 'Content-Type: application/json' \\
  -d "{\\"email\\":\\"$PAYRAM_EMAIL\\",\\"password\\":\\"$PAYRAM_PASSWORD\\"}" | jq -r .accessToken)

# 3. Project id (most installs have one project)
curl -s "$PAYRAM_URL/api/v1/external-platform/details" ${H_JWT} | jq '.[] | {id, name}'
export PROJECT_ID=1

# 4. Project API key — only for payment APIs (create payment link, merchant payouts).
#    Agent-CLI install: source ~/.payraminfo/merchant-api-key.env  (sets PAYRAM_API_KEY)
#    Otherwise: dashboard ${DASHBOARD_PAGES.apiKeys}.`,
    interpret: [
      'A null accessToken means wrong email/password (HTTP 401).',
      AUTH.jwt,
      AUTH.refresh,
      AUTH.apiKey,
      AUTH.headlessFiles,
    ],
    pitfalls: [
      'Do not use :8080 or :8443. The API is served on the same origin as the dashboard (port 80/443).',
      'The JWT expires quickly; re-run step 2 when calls start returning 401.',
      'Send ONE credential per request: if both Authorization and API-Key are present, the JWT is used (POST /api/v1/payment then fails with 404).',
      'Never send the API key or JWT to a third party, and never put them in browser code.',
    ],
    next: ['health', 'daily_check'],
  },

  health: {
    title: 'Is the server up and healthy?',
    when: 'First check for any problem. Public, no credentials.',
    auth: 'none',
    safety: 'read',
    commands: `curl -s -o /tmp/payram-health.json -w 'HTTP %{http_code}\\n' "$PAYRAM_URL/api/v1/health"
jq . /tmp/payram-health.json
curl -s "$PAYRAM_URL/api/v1/version" | jq .`,
    interpret: [
      'health.status reflects the DATABASE only (ok | degraded | error). A stopped listener still shows status "ok", so always scan health.workers.',
      `Any program in health.workers that is not RUNNING → recipe "workers". Known false alarm on current images: ${KNOWN_FALSE_ALARMS_NOTE}; ignore it unless other symptoms point there.`,
      'health.version may read "main" on some builds (e.g. arm64); then the version is unknown, not outdated.',
      'Connection refused / timeout → the container is down or the port is wrong: on the server run `docker ps | grep payram` and `docker port payram`.',
      'An HTML page instead of JSON → the URL points at something other than PayRam (proxy, wrong host).',
    ],
    pitfalls: [
      'TLS errors from curl mean the certificate is invalid or expired → payram_runbook task "ssl_renewal_fix".',
    ],
    next: ['version_check', 'workers', 'node_sync'],
  },

  version_check: {
    title: 'Am I on the latest PayRam?',
    when: 'Before troubleshooting odd behaviour, and weekly.',
    auth: 'none',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/version" | jq -r .version
curl -s ${LINKS.upgradePolicy} | jq '{latest, breakpoints}'`,
    interpret: [
      'If version < latest, an update is available. Release notes: ' + LINKS.releases,
      `A non-numeric version such as "main" means the image was built without a version tag; check the image tag on the server: docker inspect ${CONTAINER.name} --format "{{.Config.Image}}".`,
      'A breakpoint between your version and latest means a manual upgrade step is required first.',
    ],
    pitfalls: [
      'Upgrading is a human decision. Use payram_runbook task "upgrade" for the steps; do not run it unasked.',
    ],
    next: [],
  },

  workers: {
    title: 'Are the background workers running?',
    when: 'Deposits not detected, webhooks not sent, sweeps stuck.',
    auth: 'jwt',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/system/workers/status" ${H_JWT} \\
  | jq -r '.status[] | "\\(.status)\\t\\(.name)\\t\\(.details)"'`,
    interpret: [
      'Every program should be RUNNING. The list includes infrastructure (postgres, redis-server, payram-core, payram-web, nginx) and the workers.',
      `Chain listeners: ${Object.entries(CHAIN_LISTENER)
        .map(([c, w]) => `${c}→${w}`)
        .join(
          ', ',
        )}. deposit-processor turns detected deposits into payments; webhook-processor sends webhooks; account-processor handles sweeps.`,
      `A FATAL/BACKOFF worker is crash-looping: read its log before restarting (recipe "logs"). Known false alarm: ${KNOWN_FALSE_ALARMS_NOTE}.`,
      'The restartable list is also served by GET /api/v1/system/workers → {services:[…]}.',
    ],
    pitfalls: [
      `Only these can be restarted via the API: ${RESTARTABLE_WORKERS.join(', ')}. Infrastructure programs cannot; on the server use \`${CONTAINER.supervisorctl}\`.`,
      'HTTP 403 → the account lacks system-settings permission (use the root/admin login).',
    ],
    next: ['restart_worker', 'logs'],
  },

  restart_worker: {
    title: 'Restart a worker (write — confirm with the human first)',
    when: 'A worker is not RUNNING, or a listener is lagging while its nodes are healthy (see "node_sync").',
    auth: 'jwt',
    safety: 'write_needs_confirmation',
    commands: `WORKER=base-listener   # one of the restartable names below
curl -s -X POST "$PAYRAM_URL/api/v1/system/workers/$WORKER/restart" ${H_JWT} -w '\\nHTTP %{http_code}\\n'
# Restart all workers (heavier):
# curl -s -X POST "$PAYRAM_URL/api/v1/system/workers/restart" ${H_JWT}
# payram-core / payram-web:
# curl -s -X POST "$PAYRAM_URL/api/v1/system/core/restart" ${H_JWT}
sleep 60   # then re-check`,
    interpret: [
      `Restartable names: ${RESTARTABLE_WORKERS.join(', ')}. Any other name returns HTTP 400.`,
      'After ~60 s re-run "workers" and "node_sync" to confirm recovery.',
    ],
    pitfalls: [
      'A restart does not fix an unreachable RPC node or wrong RPC config; check node_sync first.',
      'Restarting deposit-processor or webhook-processor briefly delays payment processing.',
    ],
    next: ['workers', 'node_sync'],
  },

  node_sync: {
    title: 'Is each chain listener keeping up?',
    when: 'Payments on a chain are detected late or not at all.',
    auth: 'jwt',
    safety: 'read',
    commands: `# Blocks behind per chain = node tip (test-connection) − listener height (/blockchains).
curl -s "$PAYRAM_URL/api/v1/blockchains" ${H_JWT} \\
  | jq -r '.[] | select(.status=="active") | "\\(.code) \\(.height) \\(.heightTimestamp)"' \\
  | while read CODE HEIGHT TS; do
      TIP=$(curl -s "$PAYRAM_URL/api/v1/blockchain/$CODE/test-connection" ${H_JWT} \\
        | jq '[.nodes[] | select(.connected) | .lastBlockSeen] | max // "none"')
      BAD=$(curl -s "$PAYRAM_URL/api/v1/blockchain/$CODE/test-connection" ${H_JWT} \\
        | jq '[.nodes[] | select(.connected | not)] | length')
      echo "$CODE listener=$HEIGHT at $TS  node_tip=$TIP  unreachable_nodes=$BAD"
    done
# Node detail for one chain, without URLs (they can embed provider API keys):
CHAIN=BASE
curl -s "$PAYRAM_URL/api/v1/blockchain/$CHAIN/test-connection" ${H_JWT} \\
  | jq '{success, nodes: [.nodes[] | {id, connected, error, lastBlockSeen, lastBlockTimestamp, consecutiveFails, healthScore}]}'`,
    interpret: [
      'Blocks behind = node_tip − listener height. A few blocks is normal. Rough alarm levels: ETH > 50, BASE/POLYGON > 300, TRX > 200, BTC > 3, or the gap growing between two checks a minute apart.',
      'You can also compare lastBlockTimestamp (node) with heightTimestamp (listener). Do not compare heightTimestamp with your clock on testnet: BTC testnet block times can run hours ahead.',
      'Listener behind + nodes connected → restart that chain\'s listener ("restart_worker").',
      'node_tip "none" / unreachable_nodes > 0 → an RPC problem; a restart will not help. test-connection returns success:true even when some nodes fail, so read each node. Since 3.8 calls fail over to another node, so one bad backup node alone is not an outage.',
      'Smart Bridge rails (Solana, BNB, bridged BTC/Tron) have no listener; they settle as Base USDC, so check BASE.',
    ],
    pitfalls: [
      'Never print or share the full node objects from /blockchains or test-connection: node URLs and auth fields can contain provider API keys.',
      'If the jq date parsing fails on your jq version, print .heightTimestamp and compare manually.',
    ],
    next: ['restart_worker', 'workers'],
  },

  site_url: {
    title: 'Are payment links built with the right public URL?',
    when: 'Payment links show localhost/an IP, or checkout/emails point to the wrong host.',
    auth: 'jwt',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/system/site-url" ${H_JWT} | jq .`,
    interpret: [
      'Response: {siteUrl, backendUrl} (same value). null means unset, and payment creation fails until it is set.',
      'The site URL drives payment-link hosts, emails, password-reset links and webhook origin.',
      'localhost, 127.0.0.1 or a raw IP on a production server is wrong: customers cannot open those links.',
      `Fix (human, root account): open the dashboard on the PUBLIC domain (https://your-domain) and save ${DASHBOARD_PAGES.siteUrl}. The URL is taken from the page you are on, so it must be done from the public domain.`,
    ],
    pitfalls: [
      'Writing the site URL is root-only and derives the host from the request; an agent calling it via localhost would save localhost again.',
    ],
    next: ['create_payment_link'],
  },

  payment_options: {
    title: 'Which payment options and Smart Bridge rails are live for a project?',
    when: 'A coin/chain is missing at checkout, or you want to know what customers see.',
    auth: 'jwt',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/payment-options" ${H_JWT} \\
  | jq '{mainnet, options: [.options[] | {optionKey, enabled, globallyEnabled, originBlockchainCode, originNative, unmet}]}'`,
    interpret: [
      'enabled=false or globallyEnabled=false → the option is off for this project / the whole install.',
      'unmet lists what is missing, e.g. {kind:"token-accepted",chain,token} or {kind:"wallet-deployed",chain}. A kind "unverified" means the server could not evaluate requirements right now; retry.',
      `Smart Bridge rails settle as ${SMART_BRIDGE.settlesAs}. ${SMART_BRIDGE.defaults}`,
      'originNative=true on a rail means the same chain is also set up natively; the rail then replaces the native option at checkout.',
    ],
    pitfalls: [
      `${SMART_BRIDGE.merchantImpact}`,
      'Toggling an option is a write (PATCH /project/{id}/payment-options/{optionKey} {"enabled":false}); confirm with the human first.',
    ],
    next: [],
  },

  unswept_funds: {
    title: 'Are funds waiting to be swept, and why?',
    when: 'Funds are not reaching the cold wallet, or to answer "is the hot wallet low on gas?".',
    auth: 'jwt',
    safety: 'read',
    commands: `# Totals: unswept, eligible, in progress, failed, last 24h
curl -s "$PAYRAM_URL/api/v1/sweeps/metrics" ${H_JWT} | jq .
# Per wallet/currency rows (null on a fresh install):
curl -s "$PAYRAM_URL/api/v1/addresses/balance" ${H_JWT} > /tmp/payram-balances.json
jq '(. // []) | map({walletName, blockchainCode, currencyCode, amount, amountUSD, action, addressCount})' /tmp/payram-balances.json
# Recent sweep failures, with the fix hint and (for gas problems) the hot wallet to top up:
jq '[(. // [])[] | .lastSweepError | select(. != null) | {statusCode, reason, actionHint, hotWalletAddress, retryable, occurredAt}]' /tmp/payram-balances.json
# BTC sweeps waiting for a signature in the PayRam Connect app:
curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/sweep-transactions?blockchainCode=BTC&status=pending" ${H_JWT} | jq 'length'`,
    interpret: Object.entries(SWEEP_STATUS).map(([code, meaning]) => `${code}: ${meaning}`),
    pitfalls: [
      'Gas top-ups spend real money on mainnet: tell the human the hot wallet address and amount, do not send funds yourself.',
      'Per-project views: /api/v1/project/$PROJECT_ID/addresses/balance and /api/v1/project/$PROJECT_ID/sweeps/metrics.',
      'sweep-transactions needs the blockchainCode filter (without it the server returns 500).',
    ],
    next: ['node_sync', 'workers'],
  },

  payments_today: {
    title: 'What did we receive today?',
    when: 'Daily summary, reconciliation.',
    auth: 'jwt',
    safety: 'read',
    commands: `FROM=$(date -u +%Y-%m-%dT00:00:00Z); TO=$(date -u +%Y-%m-%dT23:59:59Z)
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/search" ${H_JWT} \\
  -H 'Content-Type: application/json' \\
  -d "{\\"dateFrom\\":\\"$FROM\\",\\"dateTo\\":\\"$TO\\",\\"paymentStatus\\":[\\"FILLED\\",\\"OVER_FILLED\\",\\"PARTIALLY_FILLED\\"],\\"limit\\":100}" \\
  | jq '{count: .totalCount, rows: [(.data // [])[] | {referenceId, paymentStatus, amountInUSD, createdAt}]}'
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/summary" ${H_JWT} -H 'Content-Type: application/json' -d '{}' | jq .`,
    interpret: [
      'paymentStatus values are UPPERCASE: OPEN, FILLED, PARTIALLY_FILLED, OVER_FILLED, CANCELLED.',
      'network filter values are chain codes (ETH, BASE, POLYGON, TRX, BTC); currency values are tickers (USDC, USDT, POL, …).',
      'data is null when nothing matches. summary returns counts only: {totalCount, closedCount, openCount, cancelledCount}.',
      'Use "all" instead of $PROJECT_ID to search every project.',
      'Payments made through a Smart Bridge rail show as BASE/USDC.',
    ],
    pitfalls: [
      'These routes need the dashboard login (JWT); a project API key is not accepted here.',
      'Rows contain customer emails/IDs: summarise, do not paste customer data into chat unless the human asks.',
      'If a field name differs on your version, inspect one row with `jq ".data[0]"`.',
    ],
    next: ['stuck_payment'],
  },

  payment_lookup: {
    title: 'What is the state of one payment?',
    when: 'You have a reference_id (from a payment link or webhook).',
    auth: 'none',
    safety: 'read',
    commands: `REF=00000000-0000-0000-0000-000000000000
curl -s "$PAYRAM_URL/api/v1/payment/reference/$REF" | jq .`,
    interpret: [
      'paymentState: OPEN (waiting), PARTIALLY_FILLED, FILLED (paid), OVER_FILLED, CANCELLED. Also: amountInUSD, filledAmountInUSD (strings), confirmationCurrent/confirmationRequired, depositAddress.',
      'An unknown reference returns HTTP 401 (the reference itself is the credential), not 404.',
      "CANCELLED is never sent as a webhook: poll this endpoint if you need to detect it. A new payment for the same customerID cancels that customer's older open payments.",
    ],
    pitfalls: [],
    next: ['stuck_payment'],
  },

  stuck_payment: {
    title: 'Customer says they paid but the order is not marked paid',
    when: 'Support tickets about missing payments.',
    auth: 'jwt',
    safety: 'read',
    commands: `REF=<reference_id from the payment link or order>
# 1. State of the payment
curl -s "$PAYRAM_URL/api/v1/payment/reference/$REF" | jq '{paymentState, amountInUSD, filledAmountInUSD, confirmationCurrent, confirmationRequired, depositAddress}'
# 2. Search by tx hash, customer email or ID
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/search" ${H_JWT} \\
  -H 'Content-Type: application/json' -d '{"query":"<txHash, email or reference id>","limit":10}' | jq '.data // []'
# 3. Is the chain listener caught up?  → recipe node_sync
# 4. Is deposit-processor running?      → recipe workers
# 5. Deposits PayRam saw but could not match to a payment:
curl -s "$PAYRAM_URL/api/v1/missed-deposit" ${H_JWT} | jq '.' | head -60`,
    interpret: [
      'OPEN + listener lagging → wait or fix the listener (node_sync).',
      'OPEN + tx not found after the listener caught up → the customer paid to a different address/network or with an unsupported token; check the tx on a block explorer.',
      'FILLED here but not in the shop → a webhook problem: recipe "webhooks" and check the shop\'s webhook endpoint logs.',
      'PARTIALLY_FILLED → the customer sent less than requested (fees, wrong amount).',
      'A missed deposit that belongs to this customer can be credited by a human in the dashboard.',
    ],
    pitfalls: [
      'Paying on a Smart Bridge rail settles as Base USDC: look for the payment under BASE.',
      'Do not create a new payment link for the same customerID while investigating: it cancels their open payments.',
    ],
    next: ['node_sync', 'workers', 'webhooks'],
  },

  create_payment_link: {
    title: 'Create a payment link (write — confirm with the human first)',
    when: 'The human asks for a link to send a customer.',
    auth: 'api_key',
    safety: 'write_needs_confirmation',
    commands: `curl -s -X POST "$PAYRAM_URL/api/v1/payment" ${H_KEY} \\
  -H 'Content-Type: application/json' \\
  -d '{"customerID":"cust-123","customerEmail":"buyer@example.com","amountInUSD":25}' | jq .`,
    interpret: [
      'Response: {url, reference_id, host}. Send the url to the customer as-is.',
      'customerID and customerEmail are required; amountInUSD is the USD amount.',
      'Append &test=true to preview the checkout without paying (test mode).',
    ],
    pitfalls: [
      'Creating a payment CANCELS every other open payment of the same customerID in this project. Use the real customer id; never reuse a shared/test id against a live store.',
      'HTTP 500 {"code":5} → the project needs exactly one linked deposit wallet (none or several fails), or the site URL is unset. Check Project → Wallet and recipe "site_url".',
      'HTTP 400 {"code":3} → customerEmail missing or invalid.',
      'If the url starts with http://localhost, fix the site URL first (recipe "site_url").',
    ],
    next: ['payment_lookup'],
  },

  payouts: {
    title: 'Payout (withdrawal) status and approvals',
    when: 'Checking payouts or the approval queue. Read-only: creating/approving payouts is human-only.',
    auth: 'jwt',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/withdrawals?limit=20" ${H_JWT} | jq '{total, data: .data}'
curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/withdrawals/metrics" ${H_JWT} | jq .
# Approval queue:
curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/withdrawals?status=pending-approval" ${H_JWT} | jq '.total'
# Payout limits and auto-approval for the project:
curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/payout-config" ${H_JWT} | jq .payoutConfig
# Other filters: ?blockchainCode=BASE  ?search=<address or tx hash>
# With only the project API key: GET /api/v1/withdrawal/merchant (that project's payouts)`,
    interpret: [
      'pending-approval → a human must approve or reject it in the dashboard.',
      'payout-config shows auto-approval and limits: payouts under the auto-approve amount are sent without a human.',
      'Payouts are signed by the project hot wallet; failures for gas mean the hot wallet needs native tokens.',
      'Chain codes are uppercase (ETH, BASE, POLYGON, TRX). BTC payouts are not supported.',
    ],
    pitfalls: ['Never create or approve payouts on your own.'],
    next: ['unswept_funds'],
  },

  webhooks: {
    title: 'Is the project webhook configured?',
    when: 'The shop/app is not being notified of payments.',
    auth: 'jwt',
    safety: 'read',
    commands: `curl -s "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/webhook" ${H_JWT} | jq .
# Payments whose webhook failed or is waiting:
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/search" ${H_JWT} \\
  -H 'Content-Type: application/json' -d '{"webhookStatus":["failed","waiting_for_approval"],"limit":20}' \\
  | jq '{count: .totalCount, refs: [(.data // [])[] | .referenceId]}'`,
    interpret: [
      'Check the URL is the public HTTPS endpoint of the shop/app and the webhook is active.',
      `PayRam signs every delivery: ${WEBHOOK.signature}, plus legacy ${WEBHOOK.legacyHeader}. The signing key is ${WEBHOOK.signingKey}.`,
      `${WEBHOOK.amounts} ${WEBHOOK.ping}`,
      `Failed deliveries are retried after ${WEBHOOK.retries}. webhookStatus values: received, failed, waiting_for_approval, pending, discarded.`,
      'An empty webhook list means nobody is notified of payments.',
    ],
    pitfalls: [
      'Do not press the dashboard "Test" button against an endpoint that answers 404/405: that deactivates the webhook.',
      'There is no separate "webhook secret" in the dashboard; the signing key is the project API key.',
    ],
    next: [],
  },

  logs: {
    title: 'Where are the logs? (run on the PayRam server)',
    when: 'Any 500 error, crash-looping worker, or unexplained behaviour.',
    auth: 'server_shell',
    safety: 'read',
    commands: `ls ~/.payram-core/log/
tail -n 100 ~/.payram-core/log/payram.log
tail -n 100 ~/.payram-core/log/supervisord/<program>.err.log    # e.g. base-listener
${CONTAINER.supervisorctl}
docker ps --filter name=${CONTAINER.name}; docker port ${CONTAINER.name}`,
    interpret: [
      `App logs: ${CONTAINER.logs.app}`,
      `Per-program: ${CONTAINER.logs.supervisor}`,
      CONTAINER.logs.note,
    ],
    pitfalls: ['Logs can contain customer data and addresses: share excerpts, not whole files.'],
    next: [],
  },

  daily_check: {
    title: 'Daily ops check (read-only, one script)',
    when: 'Once a day, or when the human asks "is everything OK?".',
    auth: 'jwt',
    safety: 'read',
    commands: `set -u
echo "== health";   curl -s "$PAYRAM_URL/api/v1/health" | jq -c '{status, db, version, not_running: ((.workers // {}) | to_entries | map(select(${JQ_PROGRAM_DOWN})) | from_entries)}'
echo "== latest";   curl -s ${LINKS.upgradePolicy} | jq -r .latest
echo "== site url"; curl -s "$PAYRAM_URL/api/v1/system/site-url" ${H_JWT} | jq -r .siteUrl
echo "== sweeps";   curl -s "$PAYRAM_URL/api/v1/sweeps/metrics" ${H_JWT} | jq -c '{unswept: .totalUnsweptBalance, failed: .failedSweeps, inProgress: .activeSweep.sweepsInProgress}'
echo "== sweep errors"
curl -s "$PAYRAM_URL/api/v1/addresses/balance" ${H_JWT} | jq -c '[(. // [])[] | .lastSweepError | select(. != null) | {statusCode, actionHint, hotWalletAddress}]'
echo "== payouts waiting for approval"
curl -s "$PAYRAM_URL/api/v1/project/$PROJECT_ID/withdrawals?status=pending-approval" ${H_JWT} | jq '.total'
echo "== webhook failures"
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/search" ${H_JWT} -H 'Content-Type: application/json' -d '{"webhookStatus":["failed"],"limit":1}' | jq '.totalCount'
echo "== payments (counts)"
curl -s -X POST "$PAYRAM_URL/api/v1/external-platform/$PROJECT_ID/payment/summary" ${H_JWT} -H 'Content-Type: application/json' -d '{}' | jq -c .`,
    interpret: [
      'Report only what needs attention, most urgent first: server down > workers not running > sweep failures / low gas > site URL wrong > payouts waiting > update available.',
      'For listener lag run "node_sync"; for payment-option surprises run "payment_options".',
    ],
    pitfalls: [
      'Summarise; do not paste raw customer rows.',
      "The daily check is read-only. Any fix (restart, gas top-up, toggle) needs the human's OK.",
    ],
    next: ['node_sync', 'payment_options'],
  },
};

/** Local-mode data tools → the recipe an agent should use when they cannot run. */
export const PLAYBOOK_FOR_TOOL: Record<string, OpsTask> = {
  list_platforms: 'connect',
  get_payment_summary: 'payments_today',
  get_daily_volume: 'payments_today',
  search_payments: 'payments_today',
  lookup_payment: 'payment_lookup',
  get_unswept_balances: 'unswept_funds',
  list_currencies: 'payment_options',
  list_recipients: 'payouts',
  create_payment_link: 'create_payment_link',
  check_node_sync: 'node_sync',
  restart_payram_worker: 'restart_worker',
  check_payment_readiness: 'payment_options',
};

export const getRecipe = (task: OpsTask): OpsRecipe => ({ task, ...RECIPES[task] });

export const renderRecipe = (recipe: OpsRecipe): string => {
  const lines = [
    `## ${recipe.title}`,
    `When: ${recipe.when}`,
    `Credential: ${AUTH_LABEL[recipe.auth]} · Safety: ${recipe.safety === 'read' ? 'read-only' : 'WRITE — get the human’s OK first'}`,
  ];
  if (recipe.task !== 'connect') lines.push(ENV_HINT);
  lines.push('', '```bash', recipe.commands, '```', '', 'How to read it:');
  lines.push(...recipe.interpret.map((i) => `- ${i}`));
  if (recipe.pitfalls.length) lines.push('', 'Watch out:', ...recipe.pitfalls.map((p) => `- ${p}`));
  if (recipe.next.length) lines.push('', `Next: ${recipe.next.map((n) => `"${n}"`).join(', ')}`);
  return lines.join('\n');
};

/** Teaching text for a local data tool whose credentials are not set (R-API-FOR-AGENTS). */
export const teachDirectApi = (toolName: string): string | undefined => {
  const task = PLAYBOOK_FOR_TOOL[toolName];
  if (!task) return undefined;
  return [
    `${toolName} needs PAYRAM_BASE_URL plus a JWT (PAYRAM_ACCESS_TOKEN/PAYRAM_REFRESH_TOKEN) or API key in this server's environment, and they are not set.`,
    'Do it directly instead: run the recipe below from your own shell with credentials that stay on your machine.',
    '',
    renderRecipe(getRecipe('connect')),
    '',
    renderRecipe(getRecipe(task)),
  ].join('\n');
};

export const registerOpsPlaybookTool = (server: McpServer) => {
  server.registerTool(
    'payram_ops_playbook',
    {
      title: 'PayRam ops playbook (direct API recipes)',
      description: `Exact, copy-paste recipes for day-2 operations and troubleshooting that YOU run against the merchant's PayRam API with credentials that stay on your machine: which endpoint, which credential (public / dashboard JWT / project API key), a curl+jq command, how to read the answer, and what not to do. Start with "connect". Tasks: ${OPS_TASKS.join(', ')}. Omit task to list them.`,
      inputSchema: z.object({
        task: z
          .enum(OPS_TASKS)
          .optional()
          .describe('Which recipe. Omit to get the index of tasks.'),
      }),
      outputSchema: z.object({
        tasks: z.array(
          z.object({ task: z.string(), title: z.string(), auth: z.string(), safety: z.string() }),
        ),
        recipe: recipeSchema.optional(),
      }),
    },
    safeHandler(
      async ({ task }: { task?: OpsTask }) => {
        const tasks = OPS_TASKS.map((t) => ({
          task: t,
          title: RECIPES[t].title,
          auth: RECIPES[t].auth,
          safety: RECIPES[t].safety,
        }));
        if (!task) {
          const text = [
            '# PayRam ops playbook',
            'Run these yourself against the merchant\'s PayRam (same origin as the dashboard). Start with "connect", then "daily_check".',
            '',
            ...tasks.map(
              (t) =>
                `- ${t.task} — ${t.title} [${AUTH_LABEL[t.auth]}${t.safety === 'read' ? '' : ', write'}]`,
            ),
            '',
            `Setup and one-off changes: use payram_setup_plan and payram_runbook. Health of a public URL without credentials: payram_doctor. Install command: ${INSTALL.installer}`,
          ].join('\n');
          return { content: [textContent(text)], structuredContent: { tasks } };
        }
        const recipe = getRecipe(task);
        return {
          content: [textContent(renderRecipe(recipe))],
          structuredContent: { tasks, recipe },
        };
      },
      { toolName: 'payram_ops_playbook' },
    ),
  );
};
