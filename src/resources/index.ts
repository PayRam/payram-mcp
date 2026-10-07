import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import { logger } from '../utils/logger.js';
import {
  AUTH,
  CORE_VERSION_VERIFIED,
  NATIVE_CHAINS,
  SMART_BRIDGE,
  WEBHOOK,
} from '../facts/payram.js';
import { buildSetupPlan, renderSetupPlan } from '../tools/guides/setupPlan.js';
import { OPS_TASKS, getRecipe, renderRecipe } from '../tools/guides/opsPlaybook.js';
import { RUNBOOK_TASKS, getRunbook, renderRunbook } from '../tools/guides/runbooks.js';

/**
 * Resources: read-only reference documents. Content is rendered from the
 * same sources the tools use, so the two cannot drift apart.
 */

const MARKDOWN = 'text/markdown';
const STATIC_HINT = { ttlMs: 300_000, cacheScope: 'public' as const };

const API_REFERENCE = `# PayRam API essentials (core ${CORE_VERSION_VERIFIED})

Base URL: the same origin as the dashboard, e.g. \`https://pay.example.com/api/v1\` (no :8080).

## Credentials
- ${AUTH.apiKey}
- ${AUTH.jwt}
- ${AUTH.refresh}
- ${AUTH.public}
- Send one credential per request: with both headers the JWT wins.

## Create a payment — \`POST /api/v1/payment\` (API-Key)
Request: \`{"customerID": "cust-123", "customerEmail": "buyer@example.com", "amountInUSD": 25}\` (all required).
Response: \`{"url": "https://pay.example.com/payments?reference_id=…", "reference_id": "…", "host": "…"}\` → send \`url\` to the customer.
Creating a payment cancels that customer's other open payments. HTTP 500 \`{"code":5}\`: the project needs exactly one linked deposit wallet.

## Check a payment — \`GET /api/v1/payment/reference/{reference_id}\` (no credential; the reference is the capability)
Returns \`paymentState\` (OPEN, PARTIALLY_FILLED, FILLED, OVER_FILLED, CANCELLED), \`amountInUSD\`, \`filledAmountInUSD\` (decimal strings), confirmations. Unknown references return 401.

## Webhooks (PayRam → your server)
- \`POST\` with JSON body in snake_case: \`reference_id, invoice_id, customer_id, status, amount, currency, filled_amount, filled_amount_in_usd, timestamp, payment_info[], confirmation_current, confirmation_required\`. ${WEBHOOK.amounts}
- Headers: \`${WEBHOOK.signature}\` and legacy \`${WEBHOOK.legacyHeader}\`. The key is ${WEBHOOK.signingKey}. ${WEBHOOK.verify}
- ${WEBHOOK.cancelled}
- ${WEBHOOK.ping}
- Retries: ${WEBHOOK.retries}.

## Payouts — \`POST /api/v1/withdrawal/merchant\` (API-Key; creating payouts is a human decision)
Body: \`{"customerID", "email", "blockchainCode", "currencyCode", "amount", "toAddress"}\` plus header \`Idempotency-Key\` (a duplicate within 5 minutes returns 409).
\`blockchainCode\` is the UPPERCASE chain code. Valid pairs: ${NATIVE_CHAINS.filter(
  (c) => c.payouts,
)
  .map((c) => `${c.code} → ${c.tokens}`)
  .join(' · ')}. BTC payouts are not supported. Returns 201.

## Chains
Native: ${NATIVE_CHAINS.map((c) => `${c.code} (${c.tokens})`).join('; ')}.
Smart Bridge: ${SMART_BRIDGE.rails.map((r) => r.origin).join(', ')} — settle as ${SMART_BRIDGE.settlesAs}.

## Operations
Health, workers, nodes, sweeps, payouts, webhooks: see \`payram://ops/playbook\` (every call, credential and interpretation).
`;

export const registerResources = (server: McpServer) => {
  logger.debug('Registering resources...');

  server.registerResource(
    'setup-guide',
    'payram://docs/setup-guide',
    {
      title: 'PayRam setup guide',
      description:
        'Default headless install plan (testnet, USDC on Base). Personalise with payram_setup_plan.',
      mimeType: MARKDOWN,
      cacheHint: STATIC_HINT,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MARKDOWN, text: renderSetupPlan(buildSetupPlan({})) }],
    }),
  );

  server.registerResource(
    'api-reference',
    'payram://docs/api-reference',
    {
      title: 'PayRam API essentials',
      description:
        'Payment, webhook and payout contracts plus the credential matrix, verified against current core.',
      mimeType: MARKDOWN,
      cacheHint: STATIC_HINT,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: MARKDOWN, text: API_REFERENCE }] }),
  );

  const registerTaskTemplate = <T extends string>(
    name: string,
    prefix: string,
    tasks: readonly T[],
    title: (task: T) => string,
    render: (task: T) => string,
    meta: { title: string; description: string },
  ) =>
    server.registerResource(
      name,
      new ResourceTemplate(`${prefix}{task}`, {
        list: async () => ({
          resources: tasks.map((task) => ({
            uri: `${prefix}${task}`,
            name: `${name}-${task}`,
            title: title(task),
            mimeType: MARKDOWN,
          })),
        }),
        complete: { task: (value) => tasks.filter((t) => t.startsWith(value ?? '')) },
      }),
      { ...meta, mimeType: MARKDOWN, cacheHint: STATIC_HINT },
      async (uri, { task }) => {
        const key = String(task) as T;
        if (!tasks.includes(key)) throw new ResourceNotFoundError(uri.href);
        return { contents: [{ uri: uri.href, mimeType: MARKDOWN, text: render(key) }] };
      },
    );

  registerTaskTemplate(
    'ops-playbook',
    'payram://ops/playbook/',
    OPS_TASKS,
    (t) => getRecipe(t).title,
    (t) => renderRecipe(getRecipe(t)),
    {
      title: 'PayRam ops recipe',
      description: 'One direct-API operations recipe (same content as payram_ops_playbook).',
    },
  );
  registerTaskTemplate(
    'runbook',
    'payram://runbooks/',
    RUNBOOK_TASKS,
    (t) => getRunbook(t).title,
    (t) => renderRunbook(getRunbook(t)),
    { title: 'PayRam runbook', description: 'One admin runbook (same content as payram_runbook).' },
  );

  logger.debug('Resources registered successfully');
};
