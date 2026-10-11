// NOTE: Webhook snippets are derived from docs/payram-webhook.yaml (WebhookPayload/WebhookAck).
// If that spec changes, update it first and then refresh these templates.
//
// Every PayRam webhook is signed: X-Payram-Signature: sha256=<hex HMAC-SHA256 of the raw body,
// keyed with the project API key>. The handlers below verify that over the raw bytes (never over
// re-serialised JSON), answer the unsigned-payload checks first, and treat the test ping as a 2xx.

import { SnippetResponse } from '../../common/snippetTypes.js';

const handlerNotes =
  'Verifies X-Payram-Signature (HMAC-SHA256 of the raw body, keyed with the project API key; there is no separate webhook secret). Set PAYRAM_API_KEY on the server that receives webhooks. Read the raw body: parsing the JSON first and re-serialising changes the bytes and breaks the signature. Answer 2xx quickly; PayRam retries failures and the same event can arrive more than once, so make the handler idempotent on reference_id + status. Amounts arrive as strings. The dashboard "Test connection" ping sets X-Webhook-Test: true and carries no reference_id.';

export const buildExpressWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'Express handler for Payram webhooks (POST)',
  snippet: `import express, { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { handlePayramEvent } from '../services/payramWebhookRouter';
import { PayramWebhookPayload, PayramWebhookAck } from '../services/payramWebhookTypes';

const router = express.Router();

const isValidSignature = (rawBody: Buffer, header: string | undefined, apiKey: string): boolean => {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', apiKey).update(rawBody).digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
};

// express.raw keeps the exact bytes the signature covers. Mount this route BEFORE any global
// express.json(), or exclude this path from it.
router.post('/api/payram/webhook', express.raw({ type: '*/*' }), async (req: Request, res: Response) => {
  const apiKey = process.env.PAYRAM_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'webhook_not_configured' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!isValidSignature(rawBody, req.get('X-Payram-Signature'), apiKey)) {
    return res.status(401).json({ error: 'invalid-webhook-signature' });
  }

  if (req.get('X-Webhook-Test') === 'true') {
    return res.json({ message: 'Test webhook received' });
  }

  let payload: PayramWebhookPayload;

  try {
    payload = JSON.parse(rawBody.toString('utf8')) as PayramWebhookPayload;
  } catch {
    return res.status(400).json({ error: 'invalid-json-payload' });
  }

  if (!payload?.reference_id || !payload?.status) {
    return res.status(400).json({ error: 'invalid-webhook-payload' });
  }

  try {
    await handlePayramEvent(payload);
    const ack: PayramWebhookAck = { message: 'Webhook received successfully' };
    return res.json(ack);
  } catch (error) {
    console.error('Error handling Payram webhook', error);
    return res.status(500).json({ error: 'webhook_handler_error' });
  }
});

export default router;
`,
  meta: {
    language: 'typescript',
    framework: 'express',
    filenameSuggestion: 'src/routes/payramWebhook.ts',
    description:
      'Express route that verifies the X-Payram-Signature HMAC over the raw body, then forwards the payload to your domain router.',
  },
  notes: handlerNotes,
});

export const buildNextjsWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'Next.js App Router handler for Payram webhooks (POST)',
  snippet: `// app/api/payram/webhook/route.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handlePayramEvent } from '@/lib/payram/handlePayramEvent';
import { PayramWebhookPayload, PayramWebhookAck } from '@/lib/payram/webhookTypes';

const isValidSignature = (rawBody: string, header: string | null, apiKey: string): boolean => {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', apiKey).update(rawBody).digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.PAYRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  // Read the body as text: the signature covers these exact bytes.
  const rawBody = await request.text();

  if (!isValidSignature(rawBody, request.headers.get('X-Payram-Signature'), apiKey)) {
    return NextResponse.json({ error: 'invalid-webhook-signature' }, { status: 401 });
  }

  if (request.headers.get('X-Webhook-Test') === 'true') {
    return NextResponse.json({ message: 'Test webhook received' });
  }

  let payload: PayramWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as PayramWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid-json-payload' }, { status: 400 });
  }

  if (!payload.reference_id || !payload.status) {
    return NextResponse.json({ error: 'invalid-webhook-payload' }, { status: 400 });
  }

  try {
    await handlePayramEvent(payload);
    const ack: PayramWebhookAck = { message: 'Webhook received successfully' };
    return NextResponse.json(ack);
  } catch (error) {
    console.error('Error handling Payram webhook', error);
    return NextResponse.json({ error: 'webhook_handler_error' }, { status: 500 });
  }
}
`,
  meta: {
    language: 'typescript',
    framework: 'nextjs',
    filenameSuggestion: 'app/api/payram/webhook/route.ts',
    description:
      'Next.js App Router handler that verifies the X-Payram-Signature HMAC before dispatching events.',
  },
  notes: handlerNotes,
});

export const buildFastapiWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'FastAPI handler for Payram webhooks (POST)',
  snippet: `# app/webhooks/payram.py
import hashlib
import hmac
import json
import os

from fastapi import FastAPI, HTTPException, Request
from app.services.payram_webhook_router import handle_payram_event

app = FastAPI()


def is_valid_signature(raw_body: bytes, header: str, api_key: str) -> bool:
    expected = 'sha256=' + hmac.new(api_key.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header.encode())


@app.post('/api/payram/webhook')
async def payram_webhook(request: Request):
    api_key = os.getenv('PAYRAM_API_KEY')

    if not api_key:
        raise HTTPException(status_code=500, detail='webhook_not_configured')

    # The signature covers these exact bytes; do not re-serialise before checking.
    raw_body = await request.body()

    if not is_valid_signature(raw_body, request.headers.get('X-Payram-Signature', ''), api_key):
        raise HTTPException(status_code=401, detail='invalid-webhook-signature')

    if request.headers.get('X-Webhook-Test') == 'true':
        return {'message': 'Test webhook received'}

    try:
        payload = json.loads(raw_body)
    except ValueError:
        raise HTTPException(status_code=400, detail='invalid-json-payload')

    if 'reference_id' not in payload or 'status' not in payload:
        raise HTTPException(status_code=400, detail='invalid-webhook-payload')

    await handle_payram_event(payload)

    return {'message': 'Webhook received successfully'}
`,
  meta: {
    language: 'python',
    framework: 'fastapi',
    filenameSuggestion: 'app/webhooks/payram.py',
    description:
      'FastAPI route that verifies the X-Payram-Signature HMAC over the raw body, then forwards JSON payloads.',
  },
  notes: handlerNotes,
});

export const buildGinWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'Gin handler for Payram webhooks (POST)',
  snippet: `package webhooks

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "net/http"
    "os"

    "github.com/gin-gonic/gin"
)

// Amounts arrive as JSON strings; json.Number accepts both strings and numbers.
type PayramWebhookPayload struct {
  ReferenceID       string      \`json:"reference_id"\`
  InvoiceID         string      \`json:"invoice_id"\`
  CustomerID        string      \`json:"customer_id"\`
  Status            string      \`json:"status"\`
  Amount            json.Number \`json:"amount"\`
  FilledAmountInUSD json.Number \`json:"filled_amount_in_usd"\`
  Currency          string      \`json:"currency"\`
}

func isValidPayramSignature(rawBody []byte, header, apiKey string) bool {
    mac := hmac.New(sha256.New, []byte(apiKey))
    mac.Write(rawBody)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(header))
}

func RegisterPayramRoutes(router *gin.Engine) {
    router.POST("/api/payram/webhook", func(c *gin.Context) {
        apiKey := os.Getenv("PAYRAM_API_KEY")
        if apiKey == "" {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "webhook_not_configured"})
            return
        }

        // The signature covers these exact bytes; verify before parsing.
        rawBody, err := c.GetRawData()
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid-body"})
            return
        }

        if !isValidPayramSignature(rawBody, c.GetHeader("X-Payram-Signature"), apiKey) {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid-webhook-signature"})
            return
        }

        if c.GetHeader("X-Webhook-Test") == "true" {
            c.JSON(http.StatusOK, gin.H{"message": "Test webhook received"})
            return
        }

        var payload PayramWebhookPayload
        if err := json.Unmarshal(rawBody, &payload); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid-json-payload"})
            return
        }

        if payload.ReferenceID == "" || payload.Status == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid-webhook-payload"})
            return
        }

        if err := handlePayramEvent(payload); err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "webhook_handler_error"})
            return
        }

        c.JSON(http.StatusOK, gin.H{"message": "Webhook received successfully"})
    })
}
`,
  meta: {
    language: 'go',
    framework: 'gin',
    filenameSuggestion: 'internal/webhooks/payram.go',
    description:
      'Gin route that verifies the X-Payram-Signature HMAC over the raw body before invoking your webhook router.',
  },
  notes: `${handlerNotes} Replace handlePayramEvent with your own domain service.`,
});

export const buildLaravelWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'Laravel controller for Payram webhooks (POST)',
  snippet: `use App\\Http\\Controllers\\Controller;
use App\\Services\\PayramWebhookRouter;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;

// Exclude this path from CSRF verification (webhooks are server-to-server).
Route::post('/api/payram/webhook', [PayramWebhookController::class, 'handle']);

class PayramWebhookController extends Controller
{
  public function __construct(private PayramWebhookRouter $router)
  {
  }

  public function handle(Request $request)
  {
    $apiKey = env('PAYRAM_API_KEY');

    if (!$apiKey) {
      return response()->json(['error' => 'webhook_not_configured'], 500);
    }

    // The signature covers these exact bytes; verify before decoding.
    $rawBody = $request->getContent();
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $apiKey);

    if (!hash_equals($expected, (string) $request->header('X-Payram-Signature', ''))) {
      return response()->json(['error' => 'invalid-webhook-signature'], 401);
    }

    if ($request->header('X-Webhook-Test') === 'true') {
      return response()->json(['message' => 'Test webhook received']);
    }

    $payload = json_decode($rawBody, true);

    if (!is_array($payload)) {
      return response()->json(['error' => 'invalid-json-payload'], 400);
    }

    if (empty($payload['reference_id']) || empty($payload['status'])) {
      return response()->json(['error' => 'invalid-webhook-payload'], 400);
    }

    $this->router->handle($payload);

    return response()->json(['message' => 'Webhook received successfully']);
  }
}
`,
  meta: {
    language: 'php',
    framework: 'laravel',
    filenameSuggestion: 'app/Http/Controllers/PayramWebhookController.php',
    description:
      'Laravel controller that verifies the X-Payram-Signature HMAC over the raw body and forwards payloads to a domain router.',
  },
  notes: `${handlerNotes} Replace PayramWebhookRouter with your own service for dispatching events.`,
});

export const buildSpringBootWebhookHandlerSnippet = (): SnippetResponse => ({
  title: 'Spring Boot controller for Payram webhooks (POST)',
  snippet: `package com.example.webhooks;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/payram")
public class PayramWebhookController {

    private final PayramWebhookRouter router;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public PayramWebhookController(PayramWebhookRouter router) {
        this.router = router;
    }

    @PostMapping("/webhook")
    public ResponseEntity<?> handleWebhook(
            // Take the body as a String: the signature covers these exact bytes.
            @RequestBody String rawBody,
            @RequestHeader(value = "X-Payram-Signature", required = false) String signature,
            @RequestHeader(value = "X-Webhook-Test", required = false) String testFlag)
            throws Exception {

        String apiKey = System.getenv("PAYRAM_API_KEY");

        if (apiKey == null || apiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "webhook_not_configured"));
        }

        if (!isValidSignature(rawBody, signature, apiKey)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "invalid-webhook-signature"));
        }

        if ("true".equals(testFlag)) {
            return ResponseEntity.ok(Map.of("message", "Test webhook received"));
        }

        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(rawBody, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "invalid-json-payload"));
        }

        if (!payload.containsKey("reference_id") || !payload.containsKey("status")) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "invalid-webhook-payload"));
        }

        router.handle(payload);

        return ResponseEntity.ok(Map.of("message", "Webhook received successfully"));
    }

    private static boolean isValidSignature(String rawBody, String header, String apiKey) throws Exception {
        if (header == null) {
            return false;
        }
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(apiKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = "sha256=" + HexFormat.of().formatHex(mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8)));
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), header.getBytes(StandardCharsets.UTF_8));
    }
}
`,
  meta: {
    language: 'java',
    framework: 'spring-boot',
    filenameSuggestion: 'src/main/java/com/example/webhooks/PayramWebhookController.java',
    description:
      'Spring Boot REST controller that verifies the X-Payram-Signature HMAC over the raw body and calls your router service.',
  },
  notes: `${handlerNotes} Implement PayramWebhookRouter#handle(Map<String, Object>) for your domain. Requires Java 17+.`,
});
