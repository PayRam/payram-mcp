---
name: payram-widget-integration
description: Add a PayRam "Add Credit" / tip-jar payment button to a website or web app safely. Explains why the public payram-add-credit-v1.js embed exposes a payout-capable project API key and shows the recommended backend-endpoint pattern instead, lists the attributes the script actually reads, and gives signed-webhook handlers (X-Payram-Signature HMAC over the raw body) for Express, Next.js API routes, FastAPI, Laravel, and Gin, plus idempotent processing and the retry schedule (30m, 1h, 2h, 4h, 8h, 24h, 48h). Also shows the Node SDK and raw REST API for custom checkout UI. Use when adding payment capability to an existing web frontend, embedding a tip jar or credit top-up flow, or writing the backend webhook handler that fulfils orders when a payment is FILLED.
---

# PayRam Widget Integration: Embed + Webhook Reference

> Functional reference for integrating PayRam into a web application. Covers the safe way to put a payment button on a page, the widget's real configuration, webhook handlers in five frameworks, and debugging. For the marketing framing + why-this-matters pitch see https://payram.com/skills/payram-demo-widget.md.

> ⚠️ **Never put your project API key in public HTML or browser JavaScript.**
>
> A PayRam project API key can create payments **and payouts**. The hosted `payram-add-credit-v1.js` script requires the key in a `data-api-key` attribute, so anyone who views the page source can copy it.
>
> **Use a backend endpoint that creates the payment** (section 1) and have the page call that endpoint. If a key has already been published in a page, rotate it now (Project → API keys; `payram_runbook` task `rotate_api_key`).

## 1. Recommended: a backend endpoint creates the payment

The browser sends only the amount. Your server holds the key, creates the payment and returns the hosted checkout URL.

```javascript
// server.js (Express) — the API key never leaves the server
import express from 'express';

const app = express();
const PRESET_AMOUNTS = new Set([5, 10, 25, 50, 100]);

app.post('/api/payram/checkout', express.json(), async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!PRESET_AMOUNTS.has(amount)) return res.status(400).json({ error: 'invalid amount' });

  // Take the customer from YOUR session, not from the request body.
  const user = req.user; // however your app authenticates users
  if (!user) return res.status(401).json({ error: 'sign in first' });

  const r = await fetch(`${process.env.PAYRAM_BASE_URL}/api/v1/payment`, {
    method: 'POST',
    headers: { 'API-Key': process.env.PAYRAM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerID: user.id, // a new payment cancels this customer's other open payments
      customerEmail: user.email,
      amountInUSD: amount,
    }),
  });
  if (!r.ok) return res.status(502).json({ error: 'payment creation failed' });
  const { url, reference_id } = await r.json();
  // Store reference_id -> user.id so the webhook can credit the right account.
  res.json({ url, reference_id });
});
```

```html
<!-- page.html — no API key anywhere in the page -->
<button data-amount="10">Add $10</button>
<button data-amount="25">Add $25</button>
<script>
  document.querySelectorAll('button[data-amount]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = await fetch('/api/payram/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(btn.dataset.amount) }),
      });
      if (r.ok) window.open((await r.json()).url, '_blank', 'noopener,noreferrer');
    });
  });
</script>
```

## 2. The hosted script-tag embed (internal or demo pages only)

The hosted script calls `POST /api/v1/payment` directly from the browser, so it only works with the key in the page. Use it only on pages that are not public, such as an internal admin tool or a local demo, and with a key you are prepared to rotate.

```html
<script
  src="https://payram.com/widget/payram-add-credit-v1.js"
  data-payram-url="https://pay.example.com"
  data-api-key="YOUR-PROJECT-API-KEY"
  data-amounts="5,10,25"
  data-button-text="Add Credit"
  data-theme="dark"
  data-customer-email="user@example.com"
  data-customer-id="cust_abc123"
></script>
```

The widget mounts where the script tag sits in the DOM. Clicking it creates a payment and opens the hosted checkout in a new tab.

### Configuration reference

These are the only attributes the script reads:

| Attribute             | Type              | Required | Default                | Notes                                                                |
| --------------------- | ----------------- | -------- | ---------------------- | -------------------------------------------------------------------- |
| `data-payram-url`     | URL               | yes      | —                      | Your PayRam base URL (same origin as the dashboard)                  |
| `data-api-key`        | string            | yes      | —                      | Project API key. **Exposed to every visitor**, see the warning above |
| `data-amounts`        | csv of numbers    | no       | `5,10,25`              | Preset USD amounts shown as quick-select chips                       |
| `data-button-text`    | string            | no       | `Add Credit`           | Widget title and button label                                        |
| `data-theme`          | `dark` \| `light` | no       | `dark`                 | Widget color scheme                                                  |
| `data-customer-email` | email             | no       | `customer@example.com` | Customer email sent with the payment                                 |
| `data-customer-id`    | string            | no       | random `cust_…`        | Your internal customer reference                                     |

The customer picks the chain and token on the hosted checkout. The widget has no chain, currency, custom-amount, brand-label or reference-id options.

## 3. Programmatic alternative — Node SDK (server-side)

If you want your own checkout UI:

```javascript
import { Payram } from 'payram';

const payram = new Payram({
  baseUrl: 'https://pay.example.com',
  apiKey: process.env.PAYRAM_API_KEY, // server-side only
});

const checkout = await payram.payments.initiatePayment({
  customerEmail: 'user@example.com',
  customerId: 'cust_abc123', // SDK field; serialized to customerID on the wire
  amountInUSD: 25.0,
});

// checkout.url          — hosted checkout URL (redirect customer here)
// checkout.reference_id — server-generated reference; use for idempotency + status lookups
// checkout.host         — your PayRam host (from server config)
```

The merchant create-payment endpoint takes `PaymentCreateRequest` (`customerEmail`, `customerID`, `amountInUSD`). The customer chooses the settlement chain and currency on the hosted checkout.

## 4. REST API (no SDK)

```bash
curl -X POST https://pay.example.com/api/v1/payment \
  -H "API-Key: $PAYRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerEmail": "user@example.com",
    "customerID": "cust_abc123",
    "amountInUSD": 25.00
  }'
```

> PayRam merchant endpoints authenticate with the **`API-Key`** header, **not** `Authorization: Bearer`. On the wire, `customerID` has a capital "ID" (`binding:"required"`).

Response:

```json
{
  "url": "https://pay.example.com/payments?reference_id=3f1c1e7a-...",
  "reference_id": "3f1c1e7a-...",
  "host": "https://pay.example.com"
}
```

## 5. Webhook payload contract

PayRam POSTs to the webhook URL configured in the dashboard (Project → Webhooks). The payload is snake_case:

```json
{
  "reference_id": "3f1c1e7a-...",
  "invoice_id": "inv_456",
  "customer_id": "cust_789",
  "status": "FILLED",
  "amount": "49.99",
  "currency": "USD",
  "filled_amount": "49.99",
  "filled_amount_in_usd": "49.99",
  "timestamp": 1789000000,
  "payment_info": []
}
```

- **Fields:** only `reference_id` and `status` are guaranteed present; treat the rest as optional.
- **Amounts:** they are **JSON strings** (decimals), never floats.
- **Open payload:** other fields may also appear, so don't assume a fixed set.

**Statuses (the `status` field):** `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `OVER_FILLED`, `CANCELLED`, `UNDEFINED`. `FILLED` means the expected amount was received; `OVER_FILLED`/`PARTIALLY_FILLED` indicate the customer over/under-paid.

**Retry schedule** if you don't respond 2xx: `30m, 1h, 2h, 4h, 8h, 24h, 48h`. Seven attempts total, then the webhook is marked failed (can be resent manually from the dashboard).

**Authentication:** every delivery carries `X-Payram-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, keyed with your **project API key** (the project's newest active key). A legacy `API-KEY` header is also sent. There is no separate "webhook secret" in the dashboard.

- Verify the HMAC over the **raw bytes**, before any JSON parsing.
- Compare in constant time.

**Payout ping:** before payout webhooks, PayRam sends an unsigned test request with `X-Webhook-Test: true`. Answer it with 200 and do nothing else.

**Acknowledge** with HTTP 200 and a JSON body like `{ "message": "Webhook received successfully" }` (`WebhookAck`).

## 6. Webhook handlers

Each handler does the same four things:

1. Acknowledges the ping.
2. Verifies the HMAC over the raw body with the project API key (constant time).
3. Branches on `status`.
4. Acknowledges with 200.

Before shipping goods, re-check the payment with `GET /api/v1/payment/reference/{reference_id}`.

### Express (Node.js)

```javascript
import express from 'express';
import crypto from 'crypto';

const app = express();
const processed = new Set(); // replace with Redis/DB in production
const API_KEY = process.env.PAYRAM_API_KEY; // project API key (signs webhooks)

function validSignature(rawBody, header) {
  if (!header || !API_KEY) return false;
  const expected = Buffer.from(
    'sha256=' + crypto.createHmac('sha256', API_KEY).update(rawBody).digest('hex'),
  );
  const received = Buffer.from(header);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// express.raw keeps the exact bytes PayRam signed
app.post('/webhooks/payram', express.raw({ type: 'application/json' }), (req, res) => {
  if (req.header('X-Webhook-Test') === 'true') return res.status(200).json({ ok: true });
  if (!validSignature(req.body, req.header('X-Payram-Signature'))) {
    return res.status(401).json({ message: 'invalid signature' });
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  const { reference_id, status } = payload;
  const dedupeKey = `${reference_id}:${status}`;
  if (processed.has(dedupeKey)) return res.status(200).json({ message: 'duplicate' });
  processed.add(dedupeKey);

  if (status === 'FILLED' || status === 'OVER_FILLED') {
    fulfilOrder(reference_id, payload.filled_amount_in_usd ?? payload.amount); // decimal strings
  }

  res.status(200).json({ message: 'Webhook received successfully' });
});
```

### Next.js App Router

```typescript
// app/api/webhooks/payram/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.PAYRAM_API_KEY!;

function validSignature(rawBody: Buffer, header: string | null) {
  if (!header) return false;
  const expected = Buffer.from(
    'sha256=' + crypto.createHmac('sha256', API_KEY).update(rawBody).digest('hex'),
  );
  const received = Buffer.from(header);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function POST(req: Request) {
  if (req.headers.get('x-webhook-test') === 'true') return NextResponse.json({ ok: true });

  const rawBody = Buffer.from(await req.arrayBuffer());
  if (!validSignature(rawBody, req.headers.get('x-payram-signature'))) {
    return NextResponse.json({ message: 'invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody.toString('utf8'));
  if (payload.status === 'FILLED' || payload.status === 'OVER_FILLED') {
    await fulfilOrder(payload.reference_id, payload.filled_amount_in_usd ?? payload.amount);
  }
  return NextResponse.json({ message: 'Webhook received successfully' });
}
```

### FastAPI (Python)

```python
import hashlib, hmac, json, os
from decimal import Decimal
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
API_KEY = os.environ['PAYRAM_API_KEY']  # project API key (signs webhooks)

@app.post('/webhooks/payram')
async def payram_webhook(req: Request):
    if req.headers.get('x-webhook-test') == 'true':
        return {'ok': True}

    raw_body = await req.body()
    expected = 'sha256=' + hmac.new(API_KEY.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected.encode(), req.headers.get('x-payram-signature', '').encode()):
        raise HTTPException(401, 'invalid signature')

    payload = json.loads(raw_body)
    if payload.get('status') in ('FILLED', 'OVER_FILLED'):
        amount = Decimal(payload.get('filled_amount_in_usd') or payload.get('amount') or '0')
        await fulfil_order(payload['reference_id'], amount)
    return {'message': 'Webhook received successfully'}
```

### Laravel (PHP)

```php
// routes/api.php (API routes skip CSRF verification; webhooks come from your PayRam server)
Route::post('/webhooks/payram', function (Request $req) {
    if ($req->header('X-Webhook-Test') === 'true') return response()->json(['ok' => true]);

    $raw = $req->getContent();
    $expected = 'sha256=' . hash_hmac('sha256', $raw, config('services.payram.api_key'));
    if (!hash_equals($expected, (string) $req->header('X-Payram-Signature'))) abort(401);

    $p = json_decode($raw, true);
    if (in_array($p['status'] ?? '', ['FILLED', 'OVER_FILLED'], true)) {
        // amounts are decimal strings — use bcmath/brick/money, not floats
        FulfilOrder::dispatch($p['reference_id'], $p['filled_amount_in_usd'] ?? $p['amount']);
    }
    return response()->json(['message' => 'Webhook received successfully']);
});
```

### Gin (Go)

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "io"
    "os"

    "github.com/gin-gonic/gin"
    "github.com/shopspring/decimal"
)

r.POST("/webhooks/payram", func(c *gin.Context) {
    if c.GetHeader("X-Webhook-Test") == "true" {
        c.JSON(200, gin.H{"ok": true})
        return
    }

    raw, err := io.ReadAll(c.Request.Body)
    if err != nil {
        c.JSON(400, gin.H{"message": "bad body"})
        return
    }
    mac := hmac.New(sha256.New, []byte(os.Getenv("PAYRAM_API_KEY")))
    mac.Write(raw)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    if !hmac.Equal([]byte(expected), []byte(c.GetHeader("X-Payram-Signature"))) {
        c.JSON(401, gin.H{"message": "invalid signature"})
        return
    }

    var p struct {
        ReferenceID       string           `json:"reference_id"`
        Status            string           `json:"status"`
        Amount            *decimal.Decimal `json:"amount"`               // sent as a JSON string
        FilledAmountInUSD *decimal.Decimal `json:"filled_amount_in_usd"` // sent as a JSON string
    }
    if err := json.Unmarshal(raw, &p); err != nil {
        c.JSON(400, gin.H{"message": "bad payload"})
        return
    }
    if p.Status == "FILLED" || p.Status == "OVER_FILLED" {
        fulfilOrder(p.ReferenceID, p.FilledAmountInUSD)
    }
    c.JSON(200, gin.H{"message": "Webhook received successfully"})
})
```

## 7. Idempotency pattern

The same payment can fire multiple webhooks (e.g. `OPEN` then `FILLED`), and any delivery may be retried. Make fulfilment idempotent by deduping on `reference_id + status`.

```python
# Pseudo-code — use your DB's unique constraint or Redis SETNX
key = f'processed:{payload["reference_id"]}:{payload["status"]}'
if not redis.set(key, '1', nx=True, ex=86400 * 7):
    return {'message': 'duplicate'}
fulfil_order(...)
```

Use a TTL of at least 48 hours (the longest retry window).

## 8. Common pitfalls

- **API key in the page**: the project key can create payouts. Keep it on your server (section 1) and rotate any key that was ever published.
- **Local dev webhooks**: use `ngrok` or Cloudflare Tunnel. PayRam can't reach `localhost`.
- **Verifying a parsed body**: `express.json()` and similar middleware discard the exact bytes. Compute the HMAC over the raw body, then parse it.
- **Looking for a "webhook secret"**: there isn't one. The signing key is the project API key; if the project has several, it is the newest active one.
- **Rejecting the payout ping**: answer `X-Webhook-Test: true` with 200, or payout webhooks never arrive.
- **Parsing amounts as floats**: amounts are decimal strings; a `float64` field fails to bind in Go and loses precision elsewhere.
- **Branching on a non-existent `event` field**: payment webhooks have no `event` field, so branch on `status` (`FILLED`, `OVER_FILLED`, etc.). Payout webhooks carry `event_type` (`payout.<status>`).
- **Treating optional fields as guaranteed**: only `reference_id` and `status` are always present. Default-guard everything else.
- **Handling under/over-payment**: a customer may pay less (`PARTIALLY_FILLED`) or more (`OVER_FILLED`) than expected. Decide your fulfilment policy for each rather than only handling `FILLED`.

## 9. See also

- Widget UX + positioning (website-hosted): https://payram.com/skills/payram-demo-widget.md
- Full API reference: https://docs.payram.com
- Live demo: https://payram.com/demo
- Webhook debugging tool in dashboard: Payments → Webhook Deliveries → Resend
- Existing app with user balances: `payram-topup-wallet-integration`
