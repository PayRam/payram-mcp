---
name: payram-topup-wallet-integration
description: Integrate PayRam into an EXISTING app using the recommended top-up wallet pattern — credit crypto payments to a user's in-app wallet balance first, then debit invoices from that balance. Handles every crypto payment reality (overpayment, underpayment, multiple sends, late payments, duplicate webhooks) as balance states instead of payment exceptions. Covers the ledger schema, the credit/debit flows, idempotency, concurrency, reconciliation, and PayRam's cumulative filled_amount_in_usd semantics. Use when adding PayRam to an app that has its own users/invoices/orders, when payments may not exactly match invoice amounts, or when building credits, prepaid balances, or usage billing on crypto rails.
---

# PayRam Top-Up Wallet Integration (recommended for existing apps)

> **New store with no payment history?** Use the checkout/plugin path (`payram-checkout-integration`, or the WooCommerce plugin). **Existing app with users and invoices? Use THIS pattern.**

## Why top-up-first, not pay-per-invoice

Crypto payments are approximate by nature. A customer paying a $50 invoice may send $49.20 (gas mental-math), $60 (round number), $50 in two transfers, or the right amount two hours after the link "expired" — the funds still arrive on-chain. If you bind payments directly to invoices, every one of those is an exception you must code for.

The top-up pattern flips it: **whatever arrives is credited to the user's wallet balance — exactly the amount received. Invoices are then debited from the balance as a plain, atomic app-side operation.** Every crypto quirk becomes a balance state, not a payment failure:

| Crypto reality                  | Direct-to-invoice                  | Top-up wallet                                                       |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Overpayment (OVER_FILLED)       | Refund flow needed                 | Excess stays as balance for next invoice                            |
| Underpayment (PARTIALLY_FILLED) | Failed payment, retry whole amount | Balance credited; top up just the difference                        |
| Two partial sends               | Manual matching                    | Both credit; invoice settles when balance suffices                  |
| Late payment after "expiry"     | Orphaned funds                     | Still credited; user spends it normally                             |
| Refund requested                | On-chain refund per payment        | App-side reversal entry (+ PayRam payout only if crypto must leave) |

## Architecture: the ledger

Three tables. The ledger is **append-only**; the balance is derived (cache it, but the ledger is truth).

```sql
CREATE TABLE user_wallets (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL UNIQUE,
  balance_usd   NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_ledger (
  id                   BIGSERIAL PRIMARY KEY,
  wallet_id            BIGINT NOT NULL REFERENCES user_wallets(id),
  entry_type           TEXT NOT NULL CHECK (entry_type IN
                         ('credit','credit_adjustment','debit','debit_reversal')),
  amount_usd           NUMERIC(20,8) NOT NULL CHECK (amount_usd > 0),
  payram_reference_id  TEXT,          -- set on credit/credit_adjustment
  invoice_id           BIGINT,        -- set on debit/debit_reversal
  memo                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotency: exactly ONE base credit per PayRam payment reference.
CREATE UNIQUE INDEX one_credit_per_reference
  ON wallet_ledger (payram_reference_id) WHERE entry_type = 'credit';

CREATE TABLE invoices (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  amount_usd    NUMERIC(20,8) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','awaiting_funds','paid','cancelled')),
  paid_at       TIMESTAMPTZ
);
```

Use `NUMERIC`, never floats. Everything is denominated in **USD** — PayRam's `filled_amount_in_usd` gives you the USD value of what actually arrived, so a single-currency ledger sidesteps FX entirely.

## The critical PayRam semantic: filled amounts are CUMULATIVE

One payment reference can fire several webhooks as funds arrive: `PARTIALLY_FILLED` (filled_amount_in_usd: 20.00) → `FILLED` (filled_amount_in_usd: 50.00). The amount is the **running total for that reference, not a delta**. Your credit logic must be:

```
on webhook (reference_id, status, filled_amount_in_usd):
  if status not in (PARTIALLY_FILLED, FILLED, OVER_FILLED): ack and ignore
  in one DB transaction:
    prior = SUM(amount) of credit + credit_adjustment rows for reference_id
    delta = filled_amount_in_usd - prior
    if delta <= 0: ack (duplicate or out-of-order webhook — already credited)
    insert ledger row:
      entry_type = 'credit' if prior == 0 else 'credit_adjustment'
      amount_usd = delta, payram_reference_id = reference_id
    balance_usd += delta
  then: try_settle_open_invoices(user)
```

This one function absorbs duplicates (delta ≤ 0), out-of-order delivery, partial-then-full fills, and overpayment — with zero special cases.

## The flows

### Flow A — invoice settlement (spend from balance)

```
create invoice → BEGIN; SELECT balance FROM user_wallets WHERE user_id=? FOR UPDATE;
  if balance >= invoice.amount:
      insert debit row (invoice_id), balance -= amount, invoice.status='paid'; COMMIT
  else:
      invoice.status='awaiting_funds'; COMMIT → go to Flow B for the shortfall
```

`FOR UPDATE` (or SERIALIZABLE) makes concurrent debits of one wallet safe — the balance check and the debit are one atomic unit.

### Flow B — top-up (get funds in)

```
shortfall = invoice.amount - balance
POST {payram}/api/v1/payment  (API-Key header)
  { customerEmail, customerID: "<your user_id>", amountInUSD: shortfall, invoiceID: "<your invoice id>" }
→ show returned url to the user
```

- `customerID` = **your user id** — it's how the webhook maps back to the wallet.
- `invoiceID` is optional metadata; the ledger does NOT rely on it (credits are wallet-level).
- Ask for the shortfall, not the full invoice — existing balance already counts.
- Creating a payment **cancels that customer's other open payments** in the project. Reuse the user's open link while it is still valid, rather than minting a new one on every page view.
- Create the link on your server; the project API key can also create payouts, so it never goes to the browser.

### Flow C — the credit webhook (funds arrived)

Register your webhook in the PayRam project (Project → Webhooks). PayRam POSTs snake_case JSON with amounts as **decimal strings**, and signs every delivery.

1. **Ping:** if the request carries `X-Webhook-Test: true`, it is an unsigned payout ping. Answer 200 and stop.
2. **Verify:** check the `X-Payram-Signature: sha256=<hex HMAC-SHA256 of the raw body>` header, keyed with your **project API key** (the newest active one; there is no separate webhook secret). Compute the HMAC over the raw request bytes and compare in constant time.
3. **Credit:** parse the body, run the cumulative-credit logic above, then re-attempt Flow A for any `awaiting_funds` invoices of that user.

### Flow D — refunds & cancellations

- App-level refund (user keeps money in your app): insert `debit_reversal` for the invoice → balance goes back up. No crypto moves.
- Crypto must actually leave: pay out via PayRam's payout flow (see `payram-payouts`) AND insert a matching `debit` (memo: refund payout) so the ledger mirrors reality.

## Case matrix (all of them)

| #   | Case                          | What happens                                                                                                           |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Exact payment                 | credit = invoice → Flow A settles immediately                                                                          |
| 2   | Overpayment                   | credit > invoice → invoice paid, excess remains as balance                                                             |
| 3   | Underpayment                  | credit < invoice → invoice `awaiting_funds`; UI offers top-up link for shortfall                                       |
| 4   | Multiple sends, one reference | cumulative webhooks → base credit + adjustments; settles when total suffices                                           |
| 5   | Multiple separate top-ups     | independent references → independent credits; balance accumulates                                                      |
| 6   | Late payment ("expired" link) | funds still arrive on-chain → webhook still fires → normal credit                                                      |
| 7   | Duplicate webhook delivery    | delta ≤ 0 → ignored (retry-safe by construction)                                                                       |
| 8   | Out-of-order webhooks         | cumulative math is order-independent                                                                                   |
| 9   | Concurrent invoice debits     | row lock in Flow A serializes them; CHECK (balance >= 0) is the backstop                                               |
| 10  | Refund                        | reversal entry (app-level) or payout + debit (crypto leaves)                                                           |
| 11  | Reconciliation drift          | nightly job: PayRam payment search (sum filled_amount_in_usd per reference) vs ledger credits — must match to the cent |

## PayRam API surface you use

| Purpose                  | Call                                                                                    | Auth                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Create top-up link       | `POST /api/v1/payment` `{customerEmail, customerID, amountInUSD, invoiceID?}`           | `API-Key` header                                                       |
| Check one payment        | `GET /api/v1/payment/reference/{reference_id}`                                          | reference acts as capability                                           |
| Credit webhook (inbound) | your endpoint receives `{reference_id, customer_id, status, filled_amount_in_usd, ...}` | verify `X-Payram-Signature` (HMAC-SHA256 of raw body, project API key) |
| Reconciliation           | `POST /api/v1/external-platform/{id}/payment/search` (JWT)                              | dashboard JWT                                                          |

Statuses that credit: `PARTIALLY_FILLED`, `FILLED`, `OVER_FILLED`. Ignore `OPEN`; treat `CANCELLED` as informational (no funds → no credit).

## Generate the code

The MCP tool `generate_topup_integration_snippet` emits the ledger SQL, the cumulative-credit webhook handler, and the atomic settle function for your framework — start there, then adapt table names to your app.

## Rollout checklist

1. Create the three tables; wire the webhook endpoint (verify `X-Payram-Signature` over the raw body, constant-time; ack the payout ping).
2. Implement cumulative credit + atomic settle (use the generator).
3. Point a test invoice at testnet, pay the link partially, verify `awaiting_funds` → top up → `paid`.
4. Add the nightly reconciliation query before going to mainnet.
5. Go live; monitor node sync (`payram_ops_playbook` task `node_sync`, or `check_node_sync` in local mode). A lagging chain delays credits, not correctness.
