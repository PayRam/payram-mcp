import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';

/**
 * Emits the three pieces an existing app needs to adopt PayRam via the
 * top-up wallet pattern: the ledger schema, the cumulative-credit webhook
 * handler, and the atomic invoice-settle function. See the
 * payram-topup-wallet-integration skill for the full rationale + case matrix.
 */

const inputSchema = z
  .object({
    part: z
      .enum(['schema', 'webhook', 'settle', 'all'])
      .default('all')
      .describe(
        "Which piece to emit: 'schema' (ledger DDL), 'webhook' (cumulative-credit handler), 'settle' (atomic invoice debit), or 'all'.",
      ),
    framework: z
      .enum(['express', 'fastapi'])
      .default('express')
      .describe('Server framework for the webhook handler + settle function.'),
  })
  .strict();

const schemas = buildToolSchemas({
  input: inputSchema,
  output: z.object({
    title: z.string(),
    snippet: z.string(),
    notes: z.string(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

const SCHEMA_SQL = `-- Top-up wallet ledger (append-only; balance is derived + cached).
CREATE TABLE user_wallets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL UNIQUE,
  balance_usd NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_ledger (
  id                  BIGSERIAL PRIMARY KEY,
  wallet_id           BIGINT NOT NULL REFERENCES user_wallets(id),
  entry_type          TEXT NOT NULL CHECK (entry_type IN
                        ('credit','credit_adjustment','debit','debit_reversal')),
  amount_usd          NUMERIC(20,8) NOT NULL CHECK (amount_usd > 0),
  payram_reference_id TEXT,     -- set on credit/credit_adjustment
  invoice_id          BIGINT,   -- set on debit/debit_reversal
  memo                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotency: exactly ONE base credit per PayRam payment reference.
CREATE UNIQUE INDEX one_credit_per_reference
  ON wallet_ledger (payram_reference_id) WHERE entry_type = 'credit';

CREATE TABLE invoices (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  amount_usd NUMERIC(20,8) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','awaiting_funds','paid','cancelled')),
  paid_at    TIMESTAMPTZ
);`;

const WEBHOOK_EXPRESS = `import crypto from 'crypto';
// POST from PayRam: snake_case body + an API-Key header = your webhook shared secret.
// KEY INSIGHT: filled_amount_in_usd is CUMULATIVE per reference (not a delta),
// so we credit only the increase since we last saw this reference. That single
// rule absorbs duplicate, out-of-order, partial-then-full, and overpaid webhooks.
app.post('/webhooks/payram', express.json(), async (req, res) => {
  const secret = process.env.PAYRAM_WEBHOOK_SECRET || '';
  const got = req.header('API-Key') || '';
  if (got.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return res.status(401).json({ message: 'invalid api key' });
  }

  const { reference_id, customer_id, status, filled_amount_in_usd } = req.body;
  if (!['PARTIALLY_FILLED', 'FILLED', 'OVER_FILLED'].includes(status)) {
    return res.status(200).json({ message: 'ignored (no funds credited)' });
  }

  const filled = Number(filled_amount_in_usd || 0);
  await db.tx(async (t) => {
    const wallet = await t.one(
      'SELECT id, balance_usd FROM user_wallets WHERE user_id = $1 FOR UPDATE', [customer_id]);
    const prior = Number((await t.one(
      \`SELECT COALESCE(SUM(amount_usd),0) AS s FROM wallet_ledger
       WHERE payram_reference_id = $1 AND entry_type IN ('credit','credit_adjustment')\`,
      [reference_id])).s);
    const delta = filled - prior;
    if (delta <= 0) return; // duplicate or out-of-order — already credited
    await t.none(
      \`INSERT INTO wallet_ledger (wallet_id, entry_type, amount_usd, payram_reference_id)
       VALUES ($1, $2, $3, $4)\`,
      [wallet.id, prior === 0 ? 'credit' : 'credit_adjustment', delta, reference_id]);
    await t.none('UPDATE user_wallets SET balance_usd = balance_usd + $1, updated_at = now() WHERE id = $2',
      [delta, wallet.id]);
  });

  await settleOpenInvoices(customer_id); // try to clear any awaiting_funds invoices
  return res.status(200).json({ message: 'credited' });
});`;

const SETTLE_EXPRESS = `// Atomic: lock the wallet row, check balance, debit + mark paid in ONE tx.
// Concurrent debits of the same wallet serialize on the row lock; the
// CHECK (balance_usd >= 0) is the backstop. Returns true if the invoice is paid.
async function settleInvoice(invoiceId) {
  return db.tx(async (t) => {
    const inv = await t.one('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (inv.status === 'paid') return true;
    const w = await t.one('SELECT id, balance_usd FROM user_wallets WHERE user_id = $1 FOR UPDATE', [inv.user_id]);
    if (Number(w.balance_usd) < Number(inv.amount_usd)) {
      await t.none("UPDATE invoices SET status = 'awaiting_funds' WHERE id = $1", [invoiceId]);
      return false; // caller shows a top-up link for (amount - balance)
    }
    await t.none(
      "INSERT INTO wallet_ledger (wallet_id, entry_type, amount_usd, invoice_id, memo) VALUES ($1,'debit',$2,$3,'invoice settle')",
      [w.id, inv.amount_usd, invoiceId]);
    await t.none('UPDATE user_wallets SET balance_usd = balance_usd - $1, updated_at = now() WHERE id = $2',
      [inv.amount_usd, w.id]);
    await t.none("UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1", [invoiceId]);
    return true;
  });
}

async function settleOpenInvoices(userId) {
  const open = await db.any(
    "SELECT id FROM invoices WHERE user_id = $1 AND status IN ('pending','awaiting_funds') ORDER BY id", [userId]);
  for (const { id } of open) { if (!(await settleInvoice(id))) break; }
}

// Top-up link for a shortfall (ask for the DIFFERENCE, not the whole invoice):
async function createTopUpLink(user, invoice, shortfallUsd) {
  const r = await fetch(process.env.PAYRAM_BASE_URL + '/api/v1/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Key': process.env.PAYRAM_API_KEY },
    body: JSON.stringify({
      customerEmail: user.email,
      customerID: String(user.id),   // <-- webhook maps back to the wallet via this
      amountInUSD: shortfallUsd,
      invoiceID: String(invoice.id), // optional metadata; ledger is wallet-level
    }),
  });
  const { url } = await r.json();
  return url;
}`;

const WEBHOOK_FASTAPI = `import hmac, os
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET = os.environ['PAYRAM_WEBHOOK_SECRET']

# filled_amount_in_usd is CUMULATIVE per reference; credit only the increase.
@app.post('/webhooks/payram')
async def payram_webhook(req: Request):
    if not hmac.compare_digest(req.headers.get('api-key', ''), SECRET):
        raise HTTPException(401, 'invalid api key')
    body = await req.json()
    if body.get('status') not in ('PARTIALLY_FILLED', 'FILLED', 'OVER_FILLED'):
        return {'message': 'ignored'}
    reference_id = body['reference_id']; customer_id = body['customer_id']
    filled = float(body.get('filled_amount_in_usd') or 0)
    async with db.transaction():
        wallet = await db.fetch_one(
            'SELECT id, balance_usd FROM user_wallets WHERE user_id=:u FOR UPDATE', {'u': customer_id})
        prior = float(await db.fetch_val(
            "SELECT COALESCE(SUM(amount_usd),0) FROM wallet_ledger "
            "WHERE payram_reference_id=:r AND entry_type IN ('credit','credit_adjustment')",
            {'r': reference_id}))
        delta = filled - prior
        if delta > 0:
            await db.execute(
                "INSERT INTO wallet_ledger (wallet_id, entry_type, amount_usd, payram_reference_id) "
                "VALUES (:w, :t, :a, :r)",
                {'w': wallet['id'], 't': 'credit' if prior == 0 else 'credit_adjustment',
                 'a': delta, 'r': reference_id})
            await db.execute('UPDATE user_wallets SET balance_usd = balance_usd + :a WHERE id = :w',
                             {'a': delta, 'w': wallet['id']})
    await settle_open_invoices(customer_id)
    return {'message': 'credited'}`;

const build = (part: string, framework: string): { snippet: string; notes: string } => {
  const webhook = framework === 'fastapi' ? WEBHOOK_FASTAPI : WEBHOOK_EXPRESS;
  const pieces: string[] = [];
  if (part === 'schema' || part === 'all') pieces.push('-- 1) LEDGER SCHEMA --\n' + SCHEMA_SQL);
  if (part === 'webhook' || part === 'all')
    pieces.push(`// 2) CUMULATIVE-CREDIT WEBHOOK (${framework}) //\n` + webhook);
  if (part === 'settle' || part === 'all')
    pieces.push(
      '// 3) ATOMIC INVOICE SETTLE + TOP-UP LINK //\n' +
        (framework === 'fastapi'
          ? '# Port settleInvoice/settleOpenInvoices/createTopUpLink to your async DB layer;\n# the logic is identical to the Express version below.\n' +
            SETTLE_EXPRESS
          : SETTLE_EXPRESS),
    );
  return {
    snippet: pieces.join('\n\n'),
    notes:
      'Adapt table/column names to your app. Credits are WALLET-level (keyed by customerID = your user id), ' +
      'not invoice-level — that is what makes over/under/late/duplicate payments safe. Statuses that credit: ' +
      'PARTIALLY_FILLED, FILLED, OVER_FILLED. Add the nightly reconciliation (payment search vs ledger credits) ' +
      'before mainnet. Full rationale + case matrix: the payram-topup-wallet-integration skill.',
  };
};

export const registerTopUpTools = (server: McpServer) => {
  logger.debug('Registering top-up integration tool...');
  server.registerTool(
    'generate_topup_integration_snippet',
    {
      title: 'Generate top-up wallet integration',
      description:
        'For EXISTING apps: emits the recommended top-up wallet integration — ledger schema + ' +
        'cumulative-credit webhook handler + atomic invoice-settle function. Credits crypto payments to a ' +
        "user's balance first, then debits invoices from it, so over/under/late/duplicate payments become " +
        'balance states, not payment exceptions. Pair with the payram-topup-wallet-integration skill. ' +
        '(New store with no users? Use the checkout/plugin path instead.)',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (params: z.infer<typeof inputSchema>) => {
        const { snippet, notes } = build(params.part, params.framework);
        const title = `PayRam top-up integration (${params.part}, ${params.framework})`;
        logger.info('Top-up snippet generated', { part: params.part, framework: params.framework });
        return {
          content: [textContent(`${title}\n\n${snippet}\n\n${notes}`)],
          structuredContent: { title, snippet, notes },
        };
      },
      { toolName: 'generate_topup_integration_snippet' },
    ),
  );
};
