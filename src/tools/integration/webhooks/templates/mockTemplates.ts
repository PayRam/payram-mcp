// NOTE: Webhook snippets are derived from docs/payram-webhook.yaml (WebhookPayload/WebhookAck).
// If that spec changes, update it first and then refresh these templates.
//
// The mock senders sign the body exactly like PayRam does (X-Payram-Signature: sha256=<hex HMAC-SHA256
// of the raw body, keyed with the project API key>) so they exercise the real verification path.

import { SnippetResponse } from '../../common/snippetTypes.js';
import { PayramWebhookStatus } from '../webhookTypes.js';

const mockNotes =
  'Payload follows components.schemas.WebhookPayload; amounts are strings like the real ones. The request is signed with PAYRAM_API_KEY (the same value your handler verifies with), so use a throwaway key locally. Set MOCK_WEBHOOK_URL to your endpoint.';

const examplePayload = (status: PayramWebhookStatus = 'FILLED') => `{
  "reference_id": "ref_demo_001",
  "invoice_id": "inv_demo_001",
  "customer_id": "cust_123",
  "customer_email": "user@example.com",
  "status": "${status}",
  "amount": "49.99",
  "filled_amount_in_usd": "49.99",
  "currency": "USDC"
}`;

export const buildCurlMockWebhookEventSnippet = (
  status: PayramWebhookStatus = 'FILLED',
): SnippetResponse => ({
  title: 'Send a signed mock Payram webhook with curl',
  snippet: `BODY='${examplePayload(status)}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "\${PAYRAM_API_KEY:?set PAYRAM_API_KEY}" | sed 's/^.* //')"

curl -X POST \\
  -H 'Content-Type: application/json' \\
  -H "X-Payram-Signature: $SIG" \\
  -d "$BODY" \\
  "\${MOCK_WEBHOOK_URL:-http://localhost:3000/api/payram/webhook}"`,
  meta: {
    language: 'bash',
    framework: 'generic-http',
    filenameSuggestion: 'scripts/mock-payram-webhook.sh',
    description: 'Signed curl command to replay a Payram webhook locally.',
  },
  notes: mockNotes,
});

export const buildPythonMockWebhookEventSnippet = (
  status: PayramWebhookStatus = 'FILLED',
): SnippetResponse => ({
  title: 'Send a signed mock Payram webhook with Python + httpx',
  snippet: `import hashlib
import hmac
import json
import os

import httpx

WEBHOOK_URL = os.getenv('MOCK_WEBHOOK_URL', 'http://localhost:3000/api/payram/webhook')
API_KEY = os.environ['PAYRAM_API_KEY']

payload = {
    'reference_id': 'ref_demo_001',
    'invoice_id': 'inv_demo_001',
    'customer_id': 'cust_123',
    'customer_email': 'user@example.com',
    'status': '${status}',
    'amount': '49.99',
    'filled_amount_in_usd': '49.99',
    'currency': 'USDC',
}

body = json.dumps(payload, separators=(',', ':')).encode()
signature = 'sha256=' + hmac.new(API_KEY.encode(), body, hashlib.sha256).hexdigest()

response = httpx.post(
    WEBHOOK_URL,
    content=body,
    headers={'Content-Type': 'application/json', 'X-Payram-Signature': signature},
)

print(response.status_code, response.text)
`,
  meta: {
    language: 'python',
    framework: 'generic-http',
    filenameSuggestion: 'scripts/mock_payram_webhook.py',
    description: 'Python helper that posts a signed example webhook payload via httpx.',
  },
  notes: `${mockNotes} Install httpx (pip install httpx) or swap for requests if preferred.`,
});

export const buildGoMockWebhookEventSnippet = (
  status: PayramWebhookStatus = 'FILLED',
): SnippetResponse => ({
  title: 'Send a signed mock Payram webhook with Go',
  snippet: `package main

import (
  "bytes"
  "crypto/hmac"
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "net/http"
  "os"
)

func main() {
  payload := map[string]any{
    "reference_id": "ref_demo_001",
    "invoice_id": "inv_demo_001",
    "customer_id": "cust_123",
    "customer_email": "user@example.com",
    "status": "${status}",
    "amount": "49.99",
    "filled_amount_in_usd": "49.99",
    "currency": "USDC",
  }

  body, _ := json.Marshal(payload)

  mac := hmac.New(sha256.New, []byte(os.Getenv("PAYRAM_API_KEY")))
  mac.Write(body)

  req, _ := http.NewRequest(http.MethodPost, getEnv("MOCK_WEBHOOK_URL", "http://localhost:3000/api/payram/webhook"), bytes.NewBuffer(body))
  req.Header.Set("Content-Type", "application/json")
  req.Header.Set("X-Payram-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))

  resp, err := http.DefaultClient.Do(req)
  if err != nil {
    panic(err)
  }
  defer resp.Body.Close()

  fmt.Println("Status:", resp.Status)
}

func getEnv(key, fallback string) string {
  if value := os.Getenv(key); value != "" {
    return value
  }
  return fallback
}
`,
  meta: {
    language: 'go',
    framework: 'generic-http',
    filenameSuggestion: 'cmd/mock_payram_webhook/main.go',
    description: 'Go CLI that replays a signed webhook payload to your local endpoint.',
  },
  notes: mockNotes,
});

export const buildPhpMockWebhookEventSnippet = (
  status: PayramWebhookStatus = 'FILLED',
): SnippetResponse => ({
  title: 'Send a signed mock Payram webhook with PHP + Guzzle',
  snippet: `<?php

require __DIR__.'/vendor/autoload.php';

use GuzzleHttp\\Client;

$client = new Client();

$body = json_encode([
  'reference_id' => 'ref_demo_001',
  'invoice_id' => 'inv_demo_001',
  'customer_id' => 'cust_123',
  'customer_email' => 'user@example.com',
  'status' => '${status}',
  'amount' => '49.99',
  'filled_amount_in_usd' => '49.99',
  'currency' => 'USDC',
]);

$signature = 'sha256=' . hash_hmac('sha256', $body, getenv('PAYRAM_API_KEY'));

$response = $client->post(
    getenv('MOCK_WEBHOOK_URL') ?: 'http://localhost:3000/api/payram/webhook',
    [
        'headers' => [
            'Content-Type' => 'application/json',
            'X-Payram-Signature' => $signature,
        ],
        'body' => $body,
    ],
);

echo $response->getStatusCode().' '.$response->getBody();
`,
  meta: {
    language: 'php',
    framework: 'generic-http',
    filenameSuggestion: 'scripts/mock_payram_webhook.php',
    description: 'PHP example using Guzzle to post a signed fake webhook payload.',
  },
  notes: `${mockNotes} Requires composer require guzzlehttp/guzzle.`,
});

export const buildJavaMockWebhookEventSnippet = (
  status: PayramWebhookStatus = 'FILLED',
): SnippetResponse => ({
  title: 'Send a signed mock Payram webhook with Java HttpClient',
  snippet: `package com.example.webhooks;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class MockPayramWebhookSender {
  public static void main(String[] args) throws Exception {
    String webhookUrl = System.getenv().getOrDefault("MOCK_WEBHOOK_URL", "http://localhost:3000/api/payram/webhook");
    String apiKey = System.getenv("PAYRAM_API_KEY");

    String payload = """
{
  \\"reference_id\\": \\"ref_demo_001\\",
  \\"invoice_id\\": \\"inv_demo_001\\",
  \\"customer_id\\": \\"cust_123\\",
  \\"customer_email\\": \\"user@example.com\\",
  \\"status\\": \\"${status}\\",
  \\"amount\\": \\"49.99\\",
  \\"filled_amount_in_usd\\": \\"49.99\\",
  \\"currency\\": \\"USDC\\"
}
""";

    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(apiKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String signature = "sha256=" + HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(webhookUrl))
        .header("Content-Type", "application/json")
        .header("X-Payram-Signature", signature)
        .POST(HttpRequest.BodyPublishers.ofString(payload))
        .build();

    HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());

    System.out.println(response.statusCode() + " " + response.body());
  }
}
`,
  meta: {
    language: 'java',
    framework: 'generic-http',
    filenameSuggestion: 'scripts/MockPayramWebhookSender.java',
    description: 'Java HttpClient example that simulates a signed webhook callback.',
  },
  notes: mockNotes,
});
