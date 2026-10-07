---
name: payram-webhook-integration
description: Integrate PayRam webhook handlers for real-time payment and payout event notifications. Self-hosted, no-KYC crypto payment gateway webhooks. Implement X-Payram-Signature (HMAC-SHA256) verification, event routing, and idempotent processing. Generate handlers for Express, Next.js, FastAPI, Gin, Laravel, Spring Boot. Use when setting up payment confirmation callbacks, handling payout status updates, building event-driven payment flows, or integrating PayRam events into existing systems.
---

# PayRam Webhook Setup

> **First time with PayRam?** See [`payram-setup`](https://github.com/payram/payram-mcp/tree/main/skills/payram-setup) to configure your server, API keys, and wallets.

Receive real-time notifications when payments confirm, fail, or payouts complete. Webhooks eliminate polling and enable event-driven architectures.

## Webhook Flow

```text
1. Payment status changes on-chain
2. PayRam sends a signed POST to your webhook URL
3. Your handler verifies X-Payram-Signature over the raw body
4. Process event (fulfill order, update DB)
5. Return 200 OK
```

## Configuring Webhooks in PayRam

1. In the PayRam dashboard, open **Project → Webhooks**
2. Add your endpoint URL: `https://your-app.com/api/payram/webhook`
3. Store the **project API key** (Project → API keys) as `PAYRAM_API_KEY` in your server's `.env`

There is **no separate "webhook secret"** in the dashboard. PayRam signs every delivery with the project API key. If a project has several keys, the signing key is its **newest active** key.

## Webhook Authentication

Every payment and payout webhook carries two headers:

| Header               | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `X-Payram-Signature` | `sha256=<hex HMAC-SHA256 of the raw request body, keyed with the project API key>` |
| `API-KEY`            | The project API key itself (legacy; kept for older integrations)                   |

Verify `X-Payram-Signature`:

- Compute the HMAC over the **exact raw bytes** you received, before any JSON parsing.
- Compare it in **constant time**, guarding against length differences.

Before payout webhooks, PayRam sends an **unsigned** connectivity ping (`event_type: "payout.ping"`, header `X-Webhook-Test: true`). Answer it with 200 and take no other action, or payout webhooks never arrive.

## Webhook Payload

```http
POST https://your-domain.com/api/payram/webhook
Content-Type: application/json
X-Payram-Signature: sha256=5d41402abc4b2a76b9719d911017c592...
API-KEY: <project API key>

{
  "reference_id": "3f1c1e7a-...",
  "invoice_id": "inv_xyz456",
  "customer_id": "cust_123",
  "status": "FILLED",
  "amount": "49.99",
  "currency": "USD",
  "filled_amount": "49.99",
  "filled_amount_in_usd": "49.99",
  "timestamp": 1789000000,
  "payment_info": [
    { "source_address": "0x...", "transaction_hash": "0x...", "destination_address": "0x...", "block_number": 123 }
  ],
  "confirmation_current": 12,
  "confirmation_required": 12
}
```

Amounts are **JSON strings** (decimals). Parse them with a decimal type, never a float. Payout webhooks use a different shape (`event_type: "payout.<status>"`, `payout_id`, `network`, `token`, `amount`, `tx_hash`, …).

**Critical:** Reject any request whose signature does not verify. Before fulfilling, re-check the payment with `GET /api/v1/payment/reference/{reference_id}`.

## Payment Status Events

| Status             | Meaning                                            |
| ------------------ | -------------------------------------------------- |
| `OPEN`             | Payment created, awaiting customer action          |
| `FILLED`           | Payment completed successfully (exact amount paid) |
| `PARTIALLY_FILLED` | Partial payment received (less than requested)     |
| `OVER_FILLED`      | Overpayment received (more than requested)         |
| `CANCELLED`        | Payment cancelled by customer or merchant          |
| `UNDEFINED`        | Unknown status (future compatibility)              |

## TypeScript Type Definitions

```typescript
export type PayramWebhookStatus =
  | 'OPEN'
  | 'CANCELLED'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'OVER_FILLED'
  | 'UNDEFINED';

export interface PayramWebhookPayload {
  reference_id: string;
  invoice_id?: string | null;
  customer_id?: string;
  status: PayramWebhookStatus;
  amount?: string | null; // decimal string
  currency?: string;
  filled_amount?: string | null; // decimal string
  filled_amount_in_usd?: string | null; // decimal string
  event_type?: string; // present on payout webhooks, e.g. "payout.processed"
  [key: string]: unknown;
}
```

## Signature Verification (shared helper)

```typescript
import crypto from 'crypto';

/** Verify X-Payram-Signature: sha256=hex(HMAC-SHA256(rawBody, projectApiKey)). */
export function verifyPayramSignature(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  apiKey: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = Buffer.from(
    'sha256=' + crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex'),
    'utf8',
  );
  const received = Buffer.from(signatureHeader, 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
```

## Event Router

```typescript
export async function handlePayramEvent(payload: PayramWebhookPayload) {
  if (payload.event_type?.startsWith('payout.')) {
    // Payout status update (payout.processed, payout.failed, ...)
    return;
  }
  switch (payload.status) {
    case 'FILLED':
      // Re-check via GET /api/v1/payment/reference/{id}, then mark paid and deliver
      await fulfillOrder(payload.reference_id);
      break;
    case 'PARTIALLY_FILLED':
      // Update outstanding balance, notify finance team
      break;
    case 'OVER_FILLED':
      // Queue manual review or process refund
      break;
    case 'CANCELLED':
      // Release inventory, notify customer
      break;
    case 'OPEN':
      // Record payment acknowledgement
      break;
    default:
      // Log for investigation
      console.warn('Unknown status:', payload.status);
      break;
  }
}
```

## Framework Handlers

Each handler below does three things:

1. Acknowledges the unsigned payout ping.
2. Verifies the HMAC over the raw body with the project API key.
3. Only then parses the JSON.

### Express.js

```typescript
import express, { Request, Response } from 'express';
import { verifyPayramSignature } from './verifyPayramSignature';

const router = express.Router();

// express.raw keeps the exact bytes PayRam signed; do not use express.json() on this route.
router.post(
  '/api/payram/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    if (req.get('X-Webhook-Test') === 'true') {
      return res.status(200).json({ ok: true }); // unsigned payout ping: acknowledge only
    }

    const apiKey = process.env.PAYRAM_API_KEY; // project API key (newest active)
    if (!apiKey) {
      return res.status(500).json({ error: 'webhook_not_configured' });
    }

    const rawBody = req.body as Buffer;
    if (!verifyPayramSignature(rawBody, req.get('X-Payram-Signature'), apiKey)) {
      return res.status(401).json({ error: 'invalid-signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    if (!payload?.event_type && (!payload?.reference_id || !payload?.status)) {
      return res.status(400).json({ error: 'invalid-webhook-payload' });
    }

    try {
      await handlePayramEvent(payload);
      return res.json({ message: 'Webhook received successfully' });
    } catch (error) {
      console.error('Webhook handler error:', error);
      return res.status(500).json({ error: 'webhook_handler_error' });
    }
  },
);
```

### Next.js App Router

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyPayramSignature } from '@/lib/verifyPayramSignature';

export async function POST(request: NextRequest) {
  if (request.headers.get('X-Webhook-Test') === 'true') {
    return NextResponse.json({ ok: true }); // unsigned payout ping
  }

  const apiKey = process.env.PAYRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!verifyPayramSignature(rawBody, request.headers.get('X-Payram-Signature'), apiKey)) {
    return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody.toString('utf8'));
  if (!payload.event_type && (!payload.reference_id || !payload.status)) {
    return NextResponse.json({ error: 'invalid-webhook-payload' }, { status: 400 });
  }

  try {
    await handlePayramEvent(payload);
    return NextResponse.json({ message: 'Webhook received successfully' });
  } catch (error) {
    return NextResponse.json({ error: 'webhook_handler_error' }, { status: 500 });
  }
}
```

### FastAPI (Python)

```python
import hashlib
import hmac
import json
import os

from fastapi import FastAPI, HTTPException, Request

app = FastAPI()

@app.post('/api/payram/webhook')
async def payram_webhook(request: Request):
    if request.headers.get('X-Webhook-Test') == 'true':
        return {'ok': True}  # unsigned payout ping

    api_key = os.getenv('PAYRAM_API_KEY')  # project API key
    if not api_key:
        raise HTTPException(status_code=500, detail='webhook_not_configured')

    raw_body = await request.body()
    expected = 'sha256=' + hmac.new(api_key.encode(), raw_body, hashlib.sha256).hexdigest()
    received = request.headers.get('X-Payram-Signature', '')
    # Constant-time compare (bytes, so non-ASCII input cannot raise)
    if not hmac.compare_digest(expected.encode(), received.encode()):
        raise HTTPException(status_code=401, detail='invalid-signature')

    payload = json.loads(raw_body)  # amounts stay strings; use Decimal(...) when you need numbers
    if 'event_type' not in payload and ('reference_id' not in payload or 'status' not in payload):
        raise HTTPException(status_code=400, detail='invalid-webhook-payload')

    await handle_payram_event(payload)
    return {'message': 'Webhook received successfully'}
```

### Gin (Go)

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "io"
    "net/http"
    "os"

    "github.com/gin-gonic/gin"
)

// Amounts arrive as JSON strings; keep them as strings (or decimal.Decimal), never float64.
type PayramWebhookPayload struct {
    ReferenceID       string  `json:"reference_id"`
    InvoiceID         *string `json:"invoice_id"`
    CustomerID        string  `json:"customer_id"`
    Status            string  `json:"status"`
    Amount            *string `json:"amount"`
    Currency          string  `json:"currency"`
    FilledAmount      *string `json:"filled_amount"`
    FilledAmountInUSD *string `json:"filled_amount_in_usd"`
    EventType         string  `json:"event_type"` // payout webhooks
}

func handlePayramWebhook(c *gin.Context) {
    if c.GetHeader("X-Webhook-Test") == "true" {
        c.JSON(http.StatusOK, gin.H{"ok": true}) // unsigned payout ping
        return
    }

    apiKey := os.Getenv("PAYRAM_API_KEY") // project API key
    if apiKey == "" {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "webhook_not_configured"})
        return
    }

    rawBody, err := io.ReadAll(c.Request.Body)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "unreadable-body"})
        return
    }

    mac := hmac.New(sha256.New, []byte(apiKey))
    mac.Write(rawBody)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    // hmac.Equal is constant-time and returns false on length mismatch
    if !hmac.Equal([]byte(expected), []byte(c.GetHeader("X-Payram-Signature"))) {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid-signature"})
        return
    }

    var payload PayramWebhookPayload
    if err := json.Unmarshal(rawBody, &payload); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid-json-payload"})
        return
    }

    if err := handlePayramEvent(payload); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "webhook_handler_error"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"message": "Webhook received successfully"})
}
```

### Laravel (PHP)

```php
class PayramWebhookController extends Controller
{
    public function handle(Request $request)
    {
        if ($request->header('X-Webhook-Test') === 'true') {
            return response()->json(['ok' => true]); // unsigned payout ping
        }

        $apiKey = config('services.payram.api_key'); // PAYRAM_API_KEY, the project API key
        if (!$apiKey) {
            return response()->json(['error' => 'webhook_not_configured'], 500);
        }

        $rawBody = $request->getContent();
        $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $apiKey);

        // Constant-time comparison
        if (!hash_equals($expected, (string) $request->header('X-Payram-Signature'))) {
            return response()->json(['error' => 'invalid-signature'], 401);
        }

        $payload = json_decode($rawBody, true);
        if (empty($payload['event_type']) && (empty($payload['reference_id']) || empty($payload['status']))) {
            return response()->json(['error' => 'invalid-webhook-payload'], 400);
        }

        $this->router->handle($payload);
        return response()->json(['message' => 'Webhook received successfully']);
    }
}
```

Exclude this route from CSRF verification. Webhooks come from the PayRam server, not a browser session.

### Spring Boot (Java)

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@PostMapping(value = "/api/payram/webhook", consumes = "application/json")
public ResponseEntity<?> handleWebhook(
        @RequestBody byte[] rawBody,
        @RequestHeader(value = "X-Payram-Signature", required = false) String signature,
        @RequestHeader(value = "X-Webhook-Test", required = false) String webhookTest) throws Exception {

    if ("true".equals(webhookTest)) {
        return ResponseEntity.ok(Map.of("ok", true)); // unsigned payout ping
    }

    String apiKey = System.getenv("PAYRAM_API_KEY"); // project API key
    if (apiKey == null || apiKey.isBlank()) {
        return ResponseEntity.status(500).body(Map.of("error", "webhook_not_configured"));
    }

    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(apiKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String expected = "sha256=" + HexFormat.of().formatHex(mac.doFinal(rawBody));

    // Timing-safe comparison
    boolean isValid = signature != null && MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.UTF_8),
        signature.getBytes(StandardCharsets.UTF_8)
    );
    if (!isValid) {
        return ResponseEntity.status(401).body(Map.of("error", "invalid-signature"));
    }

    Map<String, Object> payload = objectMapper.readValue(rawBody, new TypeReference<Map<String, Object>>() {});
    if (!payload.containsKey("event_type")
            && (!payload.containsKey("reference_id") || !payload.containsKey("status"))) {
        return ResponseEntity.status(400).body(Map.of("error", "invalid-webhook-payload"));
    }

    router.handle(payload);
    return ResponseEntity.ok(Map.of("message", "Webhook received successfully"));
}
```

## Best Practices

**Verify, then re-check**: The signature proves the request came from your PayRam. Before shipping goods, still confirm the state with `GET /api/v1/payment/reference/{reference_id}`, and compare amounts as decimals.

**Idempotency**: Handle duplicate deliveries gracefully — check if already processed before fulfilling:

```typescript
async function handleFilledPayment(payload: PayramWebhookPayload) {
  const existing = await db.payments.findUnique({
    where: { payramReferenceId: payload.reference_id },
  });
  if (existing && existing.status === 'completed') {
    return; // Already processed, safe to skip
  }
  await db.payments.update({
    where: { payramReferenceId: payload.reference_id },
    data: { status: 'completed', paidAt: new Date() },
  });
  await fulfillOrder(payload.customer_id, payload.reference_id);
}
```

**Quick Response**: Return 200 immediately, process asynchronously. PayRam retries on timeout.

**Retry Handling**: If you don't return 2xx, PayRam retries on a fixed schedule — 30m, 1h, 2h, 4h, 8h, 24h, 48h (7 attempts, then marked failed; resend manually from the dashboard). Return 200 once you've durably accepted the event to stop retries.

**Dashboard "Test" button**: Don't press it while your endpoint still answers 404/405. A failed test deactivates the webhook.

**Key rotation**: Webhooks are signed with the project's newest active API key. When you create a new key, switch your receiver to it at the same time.

**Database Transactions**: Use transactions for critical operations to ensure consistency.

## Testing Webhooks

### cURL Test (signed like PayRam)

```bash
BODY='{"reference_id":"ref_test_001","status":"FILLED","customer_id":"cust_123","amount":"49.99","filled_amount_in_usd":"49.99","currency":"USD"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYRAM_API_KEY" | awk '{print $NF}')"

curl -X POST http://localhost:3000/api/payram/webhook \
  -H "Content-Type: application/json" \
  -H "X-Payram-Signature: $SIG" \
  --data-raw "$BODY"

# Payout ping (must return 200)
curl -X POST http://localhost:3000/api/payram/webhook \
  -H "Content-Type: application/json" -H "X-Webhook-Test: true" \
  -d '{"event_type":"payout.ping"}'
```

### MCP Server Tools

| Tool                               | Purpose                                            |
| ---------------------------------- | -------------------------------------------------- |
| `generate_webhook_handler`         | Framework-specific handler code                    |
| `generate_webhook_event_router`    | Fan-out router for multiple event types            |
| `generate_mock_webhook_event`      | Test payloads for each event type                  |
| `payram_ops_playbook` (`webhooks`) | Check the configured webhook and failed deliveries |

## Environment Variables

```bash
# Project API key: creates payments AND verifies webhook signatures. Server-side only.
PAYRAM_API_KEY=your-project-api-key
```

## All PayRam Skills

| Skill                                | What it covers                                                            |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `payram-setup`                       | Server config, API keys, wallet setup, connectivity test                  |
| `payram-agent-onboarding`            | Headless install and the agent CLI for AI agents                          |
| `payram-analytics`                   | Analytics dashboards, reports, and payment insights via MCP tools         |
| `payram-crypto-payments`             | Architecture overview, why PayRam, MCP tools                              |
| `payram-payment-integration`         | Quick-start payment integration guide                                     |
| `payram-self-hosted-payment-gateway` | Deploy and own your payment infrastructure                                |
| `payram-checkout-integration`        | Checkout flow with SDK + HTTP for 6 frameworks                            |
| `payram-webhook-integration`         | Webhook handlers for Express, Next.js, FastAPI, Gin, Laravel, Spring Boot |
| `payram-stablecoin-payments`         | USDT/USDC acceptance across EVM chains and Tron                           |
| `payram-bitcoin-payments`            | BTC with HD wallet derivation and mobile signing                          |
| `payram-payouts`                     | Send crypto payouts and manage referral programs                          |
| `payram-no-kyc-crypto-payments`      | No-KYC, no-signup, permissionless payment acceptance                      |

## Support

Need help? Message the PayRam team on Telegram: [@PayRamChat](https://t.me/PayRamChat)

- Website: https://payram.com
- GitHub: https://github.com/PayRam
- MCP Server: https://github.com/payram/payram-mcp
