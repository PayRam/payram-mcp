import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { safeHandler } from './common/errors.js';
import { buildToolSchemas } from './common/schemas.js';

interface ScaffoldFile {
  path: string;
  description: string;
  contents: string;
}

interface ScaffoldResult extends Record<string, unknown> {
  appName: string;
  language: string;
  framework: string;
  instructions: string;
  files: ScaffoldFile[];
}

const scaffoldInputSchema = z
  .object({
    language: z
      .enum(['node', 'python', 'php', 'go', 'java'] as const)
      .describe('Programming language for the application (node for JavaScript/TypeScript)'),
    framework: z
      .enum(['express', 'nextjs', 'fastapi', 'laravel', 'gin', 'spring-boot'] as const)
      .describe('Web framework to use for scaffolding the application'),
    appName: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Name for the generated application. If not provided, defaults to payram-{framework}-starter',
      ),
    includeWebhooks: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to include webhook handler code in the scaffolded application'),
  })
  .strict();

const scaffoldOutputSchema = z.object({
  appName: z.string(),
  language: z.string(),
  framework: z.string(),
  instructions: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      description: z.string(),
      contents: z.string(),
    }),
  ),
});

const schemas = buildToolSchemas({
  input: scaffoldInputSchema,
  output: scaffoldOutputSchema,
});

const ENV_EXAMPLE = `# Payram REST base URL (include protocol)
PAYRAM_BASE_URL=http://your-payram-server.example  # TODO: replace

# Payram API key (see Payram dashboard)
PAYRAM_API_KEY=pk_test_replace_me                 # TODO: replace
`;

const textContent = (text: string) => ({ type: 'text' as const, text });

type ScaffoldInput = Omit<z.infer<typeof scaffoldInputSchema>, 'includeWebhooks'> & {
  includeWebhooks: boolean;
};

const frameworkMap: Record<
  'node' | 'python' | 'php' | 'go' | 'java',
  Array<ScaffoldInput['framework']>
> = {
  node: ['express', 'nextjs'],
  python: ['fastapi'],
  php: ['laravel'],
  go: ['gin'],
  java: ['spring-boot'],
};

type Builder = (input: ScaffoldInput) => ScaffoldResult;

const builders: Record<ScaffoldInput['framework'], Builder> = {
  express: (input) => scaffoldExpress(input),
  nextjs: (input) => scaffoldNextJs(input),
  fastapi: (input) => scaffoldFastApi(input),
  laravel: (input) => scaffoldLaravel(input),
  gin: (input) => scaffoldGin(input),
  'spring-boot': (input) => scaffoldSpringBoot(input),
};

const defaultAppName = (framework: string) => `payram-${framework}-starter`;
const sanitizeGoModuleName = (name: string) =>
  name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'payramstarter';

const expressIndexJs = (
  includeWebhooks: boolean,
) => `import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Payram } from 'payram';

dotenv.config();

if (!process.env.PAYRAM_BASE_URL || !process.env.PAYRAM_API_KEY) {
  throw new Error('PAYRAM_BASE_URL and PAYRAM_API_KEY must be configured');
}

const app = express();
app.use(cors());
${
  includeWebhooks
    ? `
// Webhooks are signed over the raw body, so this route comes before express.json().
app.post('/api/payram/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const expected = 'sha256=' + createHmac('sha256', process.env.PAYRAM_API_KEY).update(req.body).digest('hex');
  const received = req.get('X-Payram-Signature') || '';
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return res.status(401).json({ error: 'invalid-signature' });
  }
  console.log('Payram webhook event:', req.get('X-Webhook-Test') === 'true' ? 'test ping' : req.body.toString('utf8'));
  res.json({ message: 'Webhook received successfully' });
});
`
    : ''
}
app.use(express.json());
app.use(express.static('public'));

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY,
  baseUrl: process.env.PAYRAM_BASE_URL,
});

app.post('/api/payments/create', async (req, res) => {
  try {
    const { amount, currency = 'USD', referenceId } = req.body;
    const checkout = await payram.payments.initiatePayment({
      amountInUSD: Number(amount ?? 1),
      customerEmail: 'customer@example.com',
      customerId: referenceId ?? 'demo-ref',
    });
    res.json(checkout);
  } catch (error) {
    res.status(500).json({ error: 'payment_create_failed', details: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/payments/:referenceId', async (req, res) => {
  try {
    const payment = await payram.payments.getPaymentRequest(req.params.referenceId);
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'payment_status_failed', details: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/payouts/create', async (req, res) => {
  try {
    const { amount, currencyCode = 'USDT', blockchainCode = 'ETH', customerID, customerId, email = 'merchant@example.com', toAddress } = req.body;
    const normalizedCustomerID = customerID ?? customerId ?? 'demo-customer-id';
    const payout = await payram.payouts.createPayout({
      customerID: normalizedCustomerID,
      email,
      blockchainCode,
      currencyCode,
      amount: String(amount ?? '1'),
      toAddress: toAddress ?? '0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef',
    });
    res.json(payout);
  } catch (error) {
    res.status(500).json({ error: 'payout_create_failed', details: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/payouts/:id', async (req, res) => {
  try {
    const payout = await payram.payouts.getPayoutById(Number(req.params.id));
    res.json(payout);
  } catch (error) {
    res.status(500).json({ error: 'payout_status_failed', details: error instanceof Error ? error.message : String(error) });
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log('Payram Express starter listening on http://localhost:' + port);
});
`;

const expressFrontend = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Payram Starter Console</title>
    <style>
      :root {
        font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
        background: #f4f6fb;
      }

      body {
        margin: 0;
        padding: 2.5rem 1rem 3rem;
      }

      .container {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.75rem, 4vw, 2.5rem);
      }

      .subtitle {
        margin: 0.5rem 0 0;
        color: #475569;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.25rem;
      }

      .card {
        background: #fff;
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 20px 45px -24px rgba(15, 23, 42, 0.35);
        border: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .card h2 {
        margin: 0;
        font-size: 1.2rem;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      label {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.9rem;
        color: #475569;
      }

      input {
        border: 1px solid #cbd5f5;
        border-radius: 10px;
        padding: 0.55rem 0.75rem;
        font-size: 0.95rem;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }

      input:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
      }

      button {
        border: none;
        border-radius: 999px;
        background: linear-gradient(135deg, #4338ca, #6366f1);
        color: white;
        font-weight: 600;
        padding: 0.65rem 1rem;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.2s ease;
      }

      button:hover {
        transform: translateY(-1px);
        box-shadow: 0 15px 30px -18px rgba(79, 70, 229, 0.8);
      }

      pre {
        margin: 0;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 1rem;
        font-size: 0.85rem;
        max-height: 220px;
        overflow: auto;
      }

      .result-label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.85rem;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>Payram Starter Console</h1>
        <p class="subtitle">Trigger payments & payouts and inspect responses without leaving your browser.</p>
      </header>

      <div class="grid">
        <section class="card">
          <h2>Create Payment</h2>
          <form id="create-payment">
            <label>
              Amount (USD)
              <input type="number" step="0.01" name="amount" value="1" />
            </label>
            <label>
              Reference ID
              <input type="text" name="referenceId" value="demo-ref" />
            </label>
            <button type="submit">Create Payment</button>
          </form>
          <div>
            <div class="result-label">Latest response</div>
            <pre id="payment-result">{}</pre>
          </div>
        </section>

        <section class="card">
          <h2>Check Payment Status</h2>
          <form id="payment-status">
            <label>
              Reference ID
              <input type="text" name="referenceId" placeholder="demo-ref" />
            </label>
            <button type="submit">Fetch Status</button>
          </form>
          <div>
            <div class="result-label">Latest response</div>
            <pre id="payment-status-result">{}</pre>
          </div>
        </section>

        <section class="card">
          <h2>Create Payout</h2>
          <form id="create-payout">
            <label>
              Amount
              <input type="number" step="0.01" name="amount" value="1" />
            </label>
            <label>
              Currency Code
              <input type="text" name="currencyCode" value="USDT" />
            </label>
            <label>
              Blockchain Code
              <input type="text" name="blockchainCode" value="ETH" />
            </label>
            <label>
              Customer ID
              <input type="text" name="customerID" value="demo-customer-id" />
            </label>
            <label>
              Email
              <input type="email" name="email" value="merchant@example.com" />
            </label>
            <label>
              Wallet Address
              <input type="text" name="toAddress" value="0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef" />
            </label>
            <button type="submit">Create Payout</button>
          </form>
          <div>
            <div class="result-label">Latest response</div>
            <pre id="payout-result">{}</pre>
          </div>
        </section>

        <section class="card">
          <h2>Check Payout Status</h2>
          <form id="payout-status">
            <label>
              Payout ID
              <input type="number" name="payoutId" placeholder="1" min="1" />
            </label>
            <button type="submit">Fetch Status</button>
          </form>
          <div>
            <div class="result-label">Latest response</div>
            <pre id="payout-status-result">{}</pre>
          </div>
        </section>
      </div>
    </div>

    <script>
      async function submitJson(form, resultEl, { method = 'POST', url, body } = {}) {
        resultEl.textContent = 'Loading...';
        try {
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          });
          const data = await res.json();
          resultEl.textContent = JSON.stringify(data, null, 2);
          return data;
        } catch (error) {
          const errorData = { error: String(error) };
          resultEl.textContent = JSON.stringify(errorData, null, 2);
          return errorData;
        }
      }

      document.getElementById('create-payment').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        const response = await submitJson(event.target, document.getElementById('payment-result'), {
          url: '/api/payments/create',
          body: data,
        });
        if (response.url) {
          window.open(response.url, '_blank', 'noopener');
        }
      });

      document.getElementById('payment-status').addEventListener('submit', (event) => {
        event.preventDefault();
        const referenceId = new FormData(event.target).get('referenceId');
        submitJson(event.target, document.getElementById('payment-status-result'), {
          method: 'GET',
          url: '/api/payments/' + encodeURIComponent(referenceId),
        });
      });

      document.getElementById('create-payout').addEventListener('submit', (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        submitJson(event.target, document.getElementById('payout-result'), {
          url: '/api/payouts/create',
          body: data,
        });
      });

      document.getElementById('payout-status').addEventListener('submit', (event) => {
        event.preventDefault();
        const payoutId = new FormData(event.target).get('payoutId');
        submitJson(event.target, document.getElementById('payout-status-result'), {
          method: 'GET',
          url: '/api/payouts/' + encodeURIComponent(payoutId),
        });
      });
    </script>
  </body>
</html>
`;

function scaffoldExpress(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('express');
  const files: ScaffoldFile[] = [
    {
      path: '.env.example',
      description: 'Example Payram environment configuration.',
      contents: ENV_EXAMPLE,
    },
    {
      path: 'package.json',
      description: 'Package manifest for the Express starter.',
      contents: JSON.stringify(
        {
          name: appName,
          private: true,
          type: 'module',
          scripts: {
            dev: 'node src/index.js',
            start: 'NODE_ENV=production node src/index.js',
          },
          dependencies: {
            cors: '^2.8.5',
            dotenv: '^16.4.5',
            express: '^4.19.2',
            payram: '^1.0.0',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'README.md',
      description: 'Setup guide for the Express starter.',
      contents: `# ${appName}

Minimal Express app that proxies Payram payments, payouts, and webhooks with a tiny frontend.

## Getting Started

1. \`cp .env.example .env\` and fill PAYRAM_BASE_URL + PAYRAM_API_KEY.
2. Install dependencies: \`npm install\`.
3. Run dev server: \`npm run dev\`.
4. Open http://localhost:3000 to try the UI.

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. Copy your API key and server base URL from the Payram dashboard and paste them into .env as PAYRAM_API_KEY and PAYRAM_BASE_URL.
2. Under Developers → Webhooks set the URL to http://localhost:3000/api/payram/webhook while testing locally.
3. The handler verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY); a wrong key returns 401.
`
    : ''
}

Routes:
- POST /api/payments/create
- GET /api/payments/:referenceId
- POST /api/payouts/create
- GET /api/payouts/:id
${input.includeWebhooks !== false ? '- POST /api/payram/webhook' : ''}
`,
    },
    {
      path: 'src/index.js',
      description: 'Express server with payments, payouts, and optional webhook routes.',
      contents: expressIndexJs(input.includeWebhooks !== false),
    },
    {
      path: 'public/index.html',
      description: 'Simple HTML UI for testing payments and payouts.',
      contents: expressFrontend,
    },
  ];

  return {
    appName,
    language: 'node',
    framework: 'express',
    instructions:
      'Create the files in a new folder, run npm install, copy .env.example to .env with real Payram credentials, and run npm run dev. Open http://localhost:3000 to test.',
    files,
  };
}

const nextPageTsx = `"use client";
import { useState } from 'react';
import type { CSSProperties } from 'react';

async function callApi(url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const pageStyle: CSSProperties = {
  fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  padding: '2.5rem 1rem 3rem',
  margin: '0 auto',
  maxWidth: '960px',
  color: '#0f172a',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '1.25rem',
};

const cardStyle: CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: '16px',
  padding: '1.5rem',
  boxShadow: '0 20px 45px -24px rgba(15,23,42,0.35)',
  border: '1px solid #e2e8f0',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  fontSize: '0.9rem',
  color: '#475569',
};

const inputStyle: CSSProperties = {
  border: '1px solid #cbd5f5',
  borderRadius: '10px',
  padding: '0.55rem 0.75rem',
  fontSize: '0.95rem',
};

const buttonStyle: CSSProperties = {
  border: 'none',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, #4338ca, #6366f1)',
  color: '#fff',
  fontWeight: 600,
  padding: '0.65rem 1rem',
  cursor: 'pointer',
};

const resultLabelStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: '0.8rem',
  color: '#64748b',
  marginBottom: '0.35rem',
};

const preStyle: CSSProperties = {
  margin: 0,
  background: '#0f172a',
  color: '#e2e8f0',
  borderRadius: '12px',
  padding: '1rem',
  fontSize: '0.85rem',
  maxHeight: '220px',
  overflow: 'auto',
};

export default function HomePage() {
  const [paymentForm, setPaymentForm] = useState({ amount: '1', referenceId: 'demo-ref' });
  const [paymentStatusRef, setPaymentStatusRef] = useState('demo-ref');
  const [payoutForm, setPayoutForm] = useState({ amount: '1', currencyCode: 'USDT', blockchainCode: 'ETH', customerID: 'demo-customer-id', email: 'merchant@example.com', toAddress: '0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef' });
  const [payoutStatusId, setPayoutStatusId] = useState('1');

  const [paymentResult, setPaymentResult] = useState<Record<string, unknown> | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<Record<string, unknown> | null>(null);
  const [payoutResult, setPayoutResult] = useState<Record<string, unknown> | null>(null);
  const [payoutStatus, setPayoutStatus] = useState<Record<string, unknown> | null>(null);

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)' }}>Payram Starter Console</h1>
        <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
          Trigger payments & payouts and inspect responses without leaving your browser.
        </p>
      </header>

      <div style={gridStyle}>
        <section style={cardStyle}>
        <h2>Create Payment</h2>
          <form
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await callApi('/api/payments/create', {
              amount: Number(paymentForm.amount) || 0,
              referenceId: paymentForm.referenceId.trim() || undefined,
            });
            setPaymentResult(result);
            if (result.url) {
              window.open(result.url, '_blank', 'noopener');
            }
          }}
            style={formStyle}
          >
            <label style={fieldStyle}>
            Amount (USD)
            <input
              type="number"
              step="0.01"
              min="0"
              value={paymentForm.amount}
                style={inputStyle}
              onChange={(event) =>
                setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))
              }
            />
            </label>
            <label style={fieldStyle}>
            Reference ID
            <input
              type="text"
              value={paymentForm.referenceId}
                style={inputStyle}
              onChange={(event) =>
                setPaymentForm((prev) => ({ ...prev, referenceId: event.target.value }))
              }
            />
            </label>
            <button type="submit" style={buttonStyle}>
              Create payment
            </button>
          </form>
          <div>
            <div style={resultLabelStyle}>Latest response</div>
            <pre style={preStyle}>{JSON.stringify(paymentResult, null, 2)}</pre>
          </div>
        </section>

        <section style={cardStyle}>
        <h2>Check Payment Status</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!paymentStatusRef.trim()) {
              return;
            }
            setPaymentStatus(
              await callApi('/api/payments/' + encodeURIComponent(paymentStatusRef.trim())),
            );
          }}
            style={formStyle}
        >
          <label style={fieldStyle}>
            Reference ID
            <input
              type="text"
              value={paymentStatusRef}
                style={inputStyle}
              onChange={(event) => setPaymentStatusRef(event.target.value)}
            />
          </label>
            <button type="submit" style={buttonStyle}>
              Fetch payment
            </button>
          </form>
          <div>
            <div style={resultLabelStyle}>Latest response</div>
            <pre style={preStyle}>{JSON.stringify(paymentStatus, null, 2)}</pre>
          </div>
        </section>

        <section style={cardStyle}>
        <h2>Create Payout</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPayoutResult(
              await callApi('/api/payouts/create', {
                amount: Number(payoutForm.amount) || 0,
                currencyCode: payoutForm.currencyCode,
                blockchainCode: payoutForm.blockchainCode,
                customerID: payoutForm.customerID,
                email: payoutForm.email,
                toAddress: payoutForm.toAddress.trim(),
              }),
            );
          }}
            style={formStyle}
        >
          <label style={fieldStyle}>
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              value={payoutForm.amount}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, amount: event.target.value }))
              }
            />
          </label>
          <label style={fieldStyle}>
            Currency Code
            <input
              type="text"
              value={payoutForm.currencyCode}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, currencyCode: event.target.value }))
              }
            />
          </label>
          <label style={fieldStyle}>
            Blockchain Code
            <input
              type="text"
              value={payoutForm.blockchainCode}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, blockchainCode: event.target.value }))
              }
            />
          </label>
          <label style={fieldStyle}>
            Customer ID
            <input
              type="text"
              value={payoutForm.customerID}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, customerID: event.target.value }))
              }
            />
          </label>
          <label style={fieldStyle}>
            Email
            <input
              type="email"
              value={payoutForm.email}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </label>
          <label style={fieldStyle}>
            Wallet Address
            <input
              type="text"
              value={payoutForm.toAddress}
                style={inputStyle}
              onChange={(event) =>
                setPayoutForm((prev) => ({ ...prev, toAddress: event.target.value }))
              }
            />
          </label>
            <button type="submit" style={buttonStyle}>
              Create payout
            </button>
          </form>
          <div>
            <div style={resultLabelStyle}>Latest response</div>
            <pre style={preStyle}>{JSON.stringify(payoutResult, null, 2)}</pre>
          </div>
        </section>

        <section style={cardStyle}>
        <h2>Check Payout Status</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!payoutStatusId.trim()) {
              return;
            }
            setPayoutStatus(
              await callApi('/api/payouts/' + encodeURIComponent(payoutStatusId.trim())),
            );
          }}
            style={formStyle}
        >
          <label style={fieldStyle}>
            Payout ID
            <input
              type="number"
              min="1"
              value={payoutStatusId}
                style={inputStyle}
              onChange={(event) => setPayoutStatusId(event.target.value)}
            />
          </label>
            <button type="submit" style={buttonStyle}>
              Fetch payout
            </button>
          </form>
          <div>
            <div style={resultLabelStyle}>Latest response</div>
            <pre style={preStyle}>{JSON.stringify(payoutStatus, null, 2)}</pre>
          </div>
        </section>
      </div>
    </main>
  );
}
`;

const nextApiRoute = (body: string) => `import { NextResponse } from 'next/server';
import { Payram } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function POST(request: Request) {
  try {
    const payload = await request.json();
${body}
  } catch (error) {
    return NextResponse.json(
      { error: 'payram_call_failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
`;

function scaffoldNextJs(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('nextjs');
  const files: ScaffoldFile[] = [
    {
      path: '.env.example',
      description: 'Example Payram environment configuration.',
      contents: ENV_EXAMPLE,
    },
    {
      path: 'package.json',
      description: 'Package manifest for the Next.js starter.',
      contents: JSON.stringify(
        {
          name: appName,
          private: true,
          scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
          },
          dependencies: {
            next: '14.1.0',
            react: '18.2.0',
            'react-dom': '18.2.0',
            payram: '^1.0.0',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'README.md',
      description: 'Setup instructions for the Next.js starter.',
      contents: `# ${appName}

Full-stack Next.js example for Payram payments & payouts with a minimal UI.

## Getting Started

1. Copy .env.example to .env and fill PAYRAM_* values.
2. Install dependencies: \`npm install\`.
3. Run dev server: \`npm run dev\`.
4. Visit http://localhost:3000.

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. From the Payram dashboard copy your API key and base URL and place them in .env.
2. Configure a webhook endpoint pointing to http://localhost:3000/api/payram/webhook while running locally.
3. The handler verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY), so PAYRAM_API_KEY must be the key of the project the webhook belongs to.
`
    : ''
}
`,
    },
    { path: 'app/page.tsx', description: 'Next.js frontend page.', contents: nextPageTsx },
    {
      path: 'app/api/payments/create/route.ts',
      description: 'Payment creation route using Payram SDK.',
      contents: nextApiRoute(
        '    const checkout = await payram.payments.initiatePayment({ amountInUSD: payload.amount ?? 1, customerEmail: "customer@example.com", customerId: payload.referenceId ?? "demo-ref" });\n    return NextResponse.json(checkout);',
      ),
    },
    {
      path: 'app/api/payments/[referenceId]/route.ts',
      description: 'Payment status route using Payram SDK.',
      contents: `import { NextResponse } from 'next/server';
import { Payram } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function GET(_request: Request, context: { params: { referenceId: string } }) {
  try {
    const payment = await payram.payments.getPaymentRequest(context.params.referenceId);
    return NextResponse.json(payment);
  } catch (error) {
    return NextResponse.json(
      { error: 'payment_status_failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
`,
    },
    {
      path: 'app/api/payouts/create/route.ts',
      description: 'Payout creation route.',
      contents: nextApiRoute(
        '    const payout = await payram.payouts.createPayout({ customerID: payload.customerID ?? payload.customerId ?? "demo-customer-id", email: payload.email ?? "merchant@example.com", blockchainCode: payload.blockchainCode ?? "ETH", currencyCode: payload.currencyCode ?? "USDT", amount: String(payload.amount ?? "1"), toAddress: payload.toAddress ?? "0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef" });\n    return NextResponse.json(payout);',
      ),
    },
    {
      path: 'app/api/payouts/[id]/route.ts',
      description: 'Payout status route.',
      contents: `import { NextResponse } from 'next/server';
import { Payram } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const payout = await payram.payouts.getPayoutById(Number(context.params.id));
    return NextResponse.json(payout);
  } catch (error) {
    return NextResponse.json(
      { error: 'payout_status_failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
`,
    },
  ];

  if (input.includeWebhooks !== false) {
    files.push({
      path: 'app/api/payram/webhook/route.ts',
      description: 'Webhook handler for Payram events.',
      contents: `import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // The signature covers the exact bytes PayRam sent, so read the body as text and verify first.
  const rawBody = await request.text();
  const expected = 'sha256=' + createHmac('sha256', process.env.PAYRAM_API_KEY!).update(rawBody).digest('hex');
  const received = request.headers.get('X-Payram-Signature') ?? '';
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
  }
  if (request.headers.get('X-Webhook-Test') !== 'true') {
    const payload = JSON.parse(rawBody);
    console.log('Payram webhook event', payload.status, payload.reference_id);
  }
  return NextResponse.json({ message: 'Webhook received successfully' });
}
`,
    });
  }

  return {
    appName,
    language: 'node',
    framework: 'nextjs',
    instructions: 'Run npm install && npm run dev, configure .env, and open http://localhost:3000.',
    files,
  };
}

function scaffoldFastApi(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('fastapi');
  const files: ScaffoldFile[] = [
    { path: '.env.example', description: 'Payram env placeholders.', contents: ENV_EXAMPLE },
    {
      path: 'requirements.txt',
      description: 'Python dependencies.',
      contents: 'fastapi\nuvicorn\nhttpx\njinja2\npython-dotenv',
    },
    {
      path: 'README.md',
      description: 'FastAPI setup instructions.',
      contents: `# ${appName}

FastAPI starter for Payram payments, payouts, and optional webhook.

## Run locally

1. python -m venv .venv && source .venv/bin/activate
2. pip install -r requirements.txt
3. cp .env.example .env and fill PAYRAM vars
4. uvicorn main:app --reload
5. Open http://localhost:8000

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. Copy your API key and base URL from the Payram dashboard and store them in .env.
2. Configure a webhook endpoint pointing to http://localhost:8000/api/payram/webhook while running locally.
3. The route verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY); a wrong key returns 401.
`
    : ''
}
`,
    },
    {
      path: 'main.py',
      description: 'FastAPI app with API + webhook + template route.',
      contents: `import hashlib
import hmac
import json
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

load_dotenv()

PAYRAM_BASE_URL = os.getenv('PAYRAM_BASE_URL')
PAYRAM_API_KEY = os.getenv('PAYRAM_API_KEY')

app = FastAPI()
templates = Jinja2Templates(directory='templates')

if not PAYRAM_BASE_URL or not PAYRAM_API_KEY:
    raise RuntimeError('PAYRAM_BASE_URL and PAYRAM_API_KEY must be set')

client = httpx.AsyncClient(base_url=PAYRAM_BASE_URL, headers={'API-Key': PAYRAM_API_KEY})

@app.on_event('shutdown')
async def _close_client():
  await client.aclose()

@app.get('/', response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse('index.html', {'request': request})

@app.post('/api/payments/create')
async def create_payment(payload: dict):
    resp = await client.post('/api/v1/payment', json={
        'customerEmail': 'customer@example.com',
        'customerID': payload.get('referenceId', 'demo-ref'),
        'amountInUSD': payload.get('amount', 1),
    })
    return JSONResponse(resp.json(), status_code=resp.status_code)

@app.get('/api/payments/{reference_id}')
async def payment_status(reference_id: str):
    resp = await client.get(f'/api/v1/payment/reference/{reference_id}')
    return JSONResponse(resp.json(), status_code=resp.status_code)

@app.post('/api/payouts/create')
async def create_payout(payload: dict):
    resp = await client.post('/api/v1/withdrawal/merchant', json={
      'customerID': payload.get('customerID') or payload.get('customerId') or 'demo-customer-id',
      'amount': payload.get('amount', 1),
      'currencyCode': payload.get('currencyCode', 'USDT'),
        'blockchainCode': payload.get('blockchainCode', 'ETH'),
        'toAddress': payload.get('toAddress', '0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef'),
        'email': payload.get('email', 'merchant@example.com'),
    })
    return JSONResponse(resp.json(), status_code=resp.status_code)

@app.get('/api/payouts/{payout_id}')
async def payout_status(payout_id: int):
    resp = await client.get(f'/api/v1/withdrawal/{payout_id}/merchant')
    return JSONResponse(resp.json(), status_code=resp.status_code)
${
  input.includeWebhooks !== false
    ? `
@app.post('/api/payram/webhook')
async def webhook(request: Request):
  # The signature covers the exact bytes PayRam sent, so verify before parsing.
  raw = await request.body()
  expected = 'sha256=' + hmac.new(PAYRAM_API_KEY.encode(), raw, hashlib.sha256).hexdigest()
  if not hmac.compare_digest(expected.encode(), request.headers.get('X-Payram-Signature', '').encode()):
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid-signature')
  if request.headers.get('X-Webhook-Test') != 'true':
    print('Payram webhook payload', json.loads(raw))
  return {'message': 'Webhook received successfully'}
`
    : ''
}
`,
    },
    {
      path: 'templates/index.html',
      description: 'Simple HTML UI served by FastAPI.',
      contents: expressFrontend,
    },
  ];

  return {
    appName,
    language: 'python',
    framework: 'fastapi',
    instructions:
      'Create a virtualenv, install requirements, set env vars, run uvicorn main:app --reload, open http://localhost:8000.',
    files,
  };
}

function scaffoldLaravel(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('laravel');
  const files: ScaffoldFile[] = [
    { path: '.env.example', description: 'Payram env placeholders.', contents: ENV_EXAMPLE },
    {
      path: 'README.md',
      description: 'Laravel starter instructions.',
      contents: `# ${appName}

Laravel example for Payram payments and payouts with a Blade UI.

## Steps

1. composer install
2. cp .env.example .env and set PAYRAM_* plus APP_KEY
3. php artisan serve
4. Visit http://localhost:8000

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. In the Payram dashboard copy your API key + base URL and paste them into .env.
2. Add a webhook pointing to http://localhost:8000/api/payram/webhook when testing locally.
3. The controller verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY); a wrong key returns 401.
`
    : ''
}
`,
    },
    {
      path: 'routes/api.php',
      description: 'API routes for payments and payouts.',
      contents: `use Illuminate\Support\Facades\Route;
use App\Http\Controllers\PayramController;

Route::post('/payments/create', [PayramController::class, 'createPayment']);
Route::get('/payments/{referenceId}', [PayramController::class, 'paymentStatus']);
Route::post('/payouts/create', [PayramController::class, 'createPayout']);
Route::get('/payouts/{payoutId}', [PayramController::class, 'payoutStatus']);
${input.includeWebhooks !== false ? "Route::post('/payram/webhook', [PayramController::class, 'webhook']);" : ''}
`,
    },
    {
      path: 'routes/web.php',
      description: 'Serve the Blade UI.',
      contents: `use Illuminate\Support\Facades\Route;

Route::view('/', 'payram');
`,
    },
    {
      path: 'app/Http/Controllers/PayramController.php',
      description: 'Controller calling Payram HTTP APIs.',
      contents: `<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\JsonResponse;

class PayramController extends Controller
{
    private string $baseUrl;
    private string $apiKey;

    public function __construct()
    {
        $this->baseUrl = env('PAYRAM_BASE_URL');
        $this->apiKey = env('PAYRAM_API_KEY');
    }

    private function client()
    {
        return Http::withHeaders(['API-Key' => $this->apiKey]);
    }

    public function createPayment(Request $request): JsonResponse
    {
        $response = $this->client()->post($this->baseUrl.'/api/v1/payment', [
            'customerEmail' => 'customer@example.com',
            'customerID' => $request->input('referenceId', 'demo-ref'),
            'amountInUSD' => $request->input('amount', 1),
        ]);
        return response()->json($response->json(), $response->status());
    }

    public function paymentStatus(string $referenceId): JsonResponse
    {
        $response = $this->client()->get($this->baseUrl.'/api/v1/payment/reference/'.$referenceId);
        return response()->json($response->json(), $response->status());
    }

    public function createPayout(Request $request): JsonResponse
    {
        $response = $this->client()->post($this->baseUrl.'/api/v1/withdrawal/merchant', [
          'customerID' => $request->input('customerID', $request->input('customerId', 'demo-customer-id')),
          'amount' => $request->input('amount', 1),
          'currencyCode' => $request->input('currencyCode', 'USDT'),
            'blockchainCode' => $request->input('blockchainCode', 'ETH'),
            'toAddress' => $request->input('toAddress'),
            'email' => $request->input('email', 'merchant@example.com'),
        ]);
        return response()->json($response->json(), $response->status());
    }

    public function payoutStatus(int $payoutId): JsonResponse
    {
        $response = $this->client()->get($this->baseUrl.'/api/v1/withdrawal/'.$payoutId.'/merchant');
        return response()->json($response->json(), $response->status());
    }
${
  input.includeWebhooks !== false
    ? `
    public function webhook(Request $request): JsonResponse
    {
      // The signature covers the exact bytes PayRam sent, so verify the raw body.
      $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), $this->apiKey);
      if (!hash_equals($expected, (string) $request->header('X-Payram-Signature', ''))) {
        return response()->json(['error' => 'invalid-signature'], 401);
      }

      if ($request->header('X-Webhook-Test') !== 'true') {
        logger()->info('Payram webhook payload', json_decode($request->getContent(), true) ?? []);
      }
      return response()->json(['message' => 'Webhook received successfully']);
    }
`
    : ''
}
}
`,
    },
    {
      path: 'resources/views/payram.blade.php',
      description: 'Simple Blade template with forms.',
      contents: expressFrontend,
    },
  ];

  return {
    appName,
    language: 'php',
    framework: 'laravel',
    instructions:
      'Use composer install, set env vars, php artisan serve, open http://localhost:8000.',
    files,
  };
}

function scaffoldGin(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('gin');
  const files: ScaffoldFile[] = [
    { path: '.env.example', description: 'Payram env placeholders.', contents: ENV_EXAMPLE },
    {
      path: 'go.mod',
      description: 'Go module definition.',
      contents: `module github.com/payram/${sanitizeGoModuleName(appName)}

    go 1.21

    require (
      github.com/gin-gonic/gin v1.10.0
      github.com/joho/godotenv v1.5.1
    )
    `,
    },
    {
      path: 'README.md',
      description: 'Gin starter instructions.',
      contents: `# ${appName}

Gin starter for Payram payments, payouts, and webhook.

## Run

1. go mod tidy
2. cp .env.example .env and set values
3. go run main.go
4. Open http://localhost:3000

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. Copy PAYRAM_BASE_URL and PAYRAM_API_KEY from the Payram dashboard into .env.
2. Add a webhook endpoint targeting http://localhost:3000/api/payram/webhook for local testing.
3. The handler verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY); a wrong key returns 401.
`
    : ''
}
`,
    },
    {
      path: 'main.go',
      description: 'Gin server with API routes.',
      contents: `package main

import (
  "bytes"
  "crypto/hmac"
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "io"
  "log"
  "net/http"
  "os"

  "github.com/gin-gonic/gin"
  "github.com/joho/godotenv"
)

var payramBase string
var payramKey string

func init() {
  _ = godotenv.Load()
  payramBase = os.Getenv("PAYRAM_BASE_URL")
  payramKey = os.Getenv("PAYRAM_API_KEY")
}

func main() {
  if payramBase == "" || payramKey == "" {
    log.Fatal("PAYRAM_BASE_URL and PAYRAM_API_KEY are required")
  }

  router := gin.Default()
  router.StaticFile("/", "templates/index.html")

  api := router.Group("/api")
  {
    api.POST("/payments/create", createPayment)
    api.GET("/payments/:referenceId", paymentStatus)
    api.POST("/payouts/create", createPayout)
    api.GET("/payouts/:id", payoutStatus)
${input.includeWebhooks !== false ? '    api.POST("/payram/webhook", webhook)' : ''}
  }

  router.Run(":3000")
}

func payramClient(method, path string, payload interface{}) (*http.Response, error) {
  var body io.Reader
  if payload != nil {
    data, _ := json.Marshal(payload)
    body = bytes.NewReader(data)
  }
  req, _ := http.NewRequest(method, payramBase+path, body)
  req.Header.Set("API-Key", payramKey)
  req.Header.Set("Content-Type", "application/json")
  return http.DefaultClient.Do(req)
}

func createPayment(c *gin.Context) {
  var payload map[string]interface{}
  if err := c.ShouldBindJSON(&payload); err != nil {
    payload = map[string]interface{}{}
  }
  body := map[string]interface{}{
    "customerEmail": "customer@example.com",
    "customerID": payload["referenceId"],
    "amountInUSD": payload["amount"],
  }
  if body["customerID"] == nil {
    body["customerID"] = "demo-ref"
  }
  if body["amountInUSD"] == nil {
    body["amountInUSD"] = 1
  }
  resp, err := payramClient("POST", "/api/v1/payment", body)
  respond(c, resp, err)
}

func paymentStatus(c *gin.Context) {
  resp, err := payramClient("GET", "/api/v1/payment/reference/"+c.Param("referenceId"), nil)
  respond(c, resp, err)
}

func createPayout(c *gin.Context) {
  var payload map[string]interface{}
  if err := c.ShouldBindJSON(&payload); err != nil {
    payload = map[string]interface{}{}
  }
  body := map[string]interface{}{
    "customerID": payload["customerID"],
    "amount": payload["amount"],
    "currencyCode": payload["currencyCode"],
    "blockchainCode": payload["blockchainCode"],
    "toAddress": payload["toAddress"],
    "email": payload["email"],
  }
  if body["amount"] == nil {
    body["amount"] = 1
  }
  if body["currencyCode"] == nil {
    body["currencyCode"] = "USDT"
  }
  if body["blockchainCode"] == nil {
    body["blockchainCode"] = "ETH"
  }
  if body["customerID"] == nil {
    if legacy, ok := payload["customerId"]; ok {
      body["customerID"] = legacy
    } else {
      body["customerID"] = "demo-customer-id"
    }
  }
  if body["email"] == nil {
    body["email"] = "merchant@example.com"
  }
  if body["toAddress"] == nil {
    body["toAddress"] = "0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef"
  }
  resp, err := payramClient("POST", "/api/v1/withdrawal/merchant", body)
  respond(c, resp, err)
}

func payoutStatus(c *gin.Context) {
  resp, err := payramClient("GET", "/api/v1/withdrawal/"+c.Param("id")+"/merchant", nil)
  respond(c, resp, err)
}
${
  input.includeWebhooks !== false
    ? `
func webhook(c *gin.Context) {
  // The signature covers the exact bytes PayRam sent, so verify before parsing.
  raw, _ := c.GetRawData()
  mac := hmac.New(sha256.New, []byte(payramKey))
  mac.Write(raw)
  expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
  if !hmac.Equal([]byte(expected), []byte(c.GetHeader("X-Payram-Signature"))) {
    c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid-signature"})
    return
  }
  if c.GetHeader("X-Webhook-Test") != "true" {
    log.Println("Payram webhook payload", string(raw))
  }
  c.JSON(http.StatusOK, gin.H{"message": "Webhook received successfully"})
}
`
    : ''
}

func respond(c *gin.Context, resp *http.Response, err error) {
  if err != nil {
    c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
    return
  }
  defer resp.Body.Close()
  var data interface{}
  json.NewDecoder(resp.Body).Decode(&data)
  c.JSON(resp.StatusCode, data)
}
`,
    },
    {
      path: 'templates/index.html',
      description: 'Simple HTML UI served by Gin.',
      contents: expressFrontend,
    },
  ];

  return {
    appName,
    language: 'go',
    framework: 'gin',
    instructions: 'Run go mod tidy && go run main.go, configure .env, open http://localhost:3000.',
    files,
  };
}

function scaffoldSpringBoot(input: ScaffoldInput): ScaffoldResult {
  const appName = input.appName ?? defaultAppName('spring-boot');
  const files: ScaffoldFile[] = [
    { path: '.env.example', description: 'Payram env placeholders.', contents: ENV_EXAMPLE },
    {
      path: 'README.md',
      description: 'Spring Boot starter instructions.',
      contents: `# ${appName}

Spring Boot example for Payram payments, payouts, webhook, and a Thymeleaf UI.

## Run

1. ./mvnw spring-boot:run
2. Set PAYRAM_* via environment or application.properties
3. Visit http://localhost:8080

${
  input.includeWebhooks !== false
    ? `## Payram dashboard checklist

1. Grab your API key + base URL from the Payram dashboard and expose them as PAYRAM_API_KEY / PAYRAM_BASE_URL.
2. Create a webhook endpoint pointing to http://localhost:8080/api/payram/webhook while running locally.
3. The controller verifies the X-Payram-Signature header (HMAC-SHA256 of the raw body, keyed with PAYRAM_API_KEY); a wrong key returns 401.
`
    : ''
}
`,
    },
    {
      path: 'pom.xml',
      description: 'Maven configuration.',
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>${appName}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.5</version>
  </parent>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-thymeleaf</artifactId>
    </dependency>
  </dependencies>
</project>
`,
    },
    {
      path: 'src/main/java/com/example/payram/PayramApplication.java',
      description: 'Spring Boot entrypoint.',
      contents: `package com.example.payram;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class PayramApplication {
  public static void main(String[] args) {
    SpringApplication.run(PayramApplication.class, args);
  }
}
`,
    },
    {
      path: 'src/main/java/com/example/payram/PayramController.java',
      description: 'REST controller for payments, payouts, webhook.',
      contents: `package com.example.payram;

import java.util.Map;
import java.util.HashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

@Controller
class PageController {
  @GetMapping("/")
  public String index(Model model) {
    return "index";
  }
}

@RestController
@RequestMapping("/api")
class PayramApiController {
  private final RestTemplate restTemplate = new RestTemplate();

  @Value("\${PAYRAM_BASE_URL}")
  private String baseUrl;

  @Value("\${PAYRAM_API_KEY}")
  private String apiKey;

  private ResponseEntity<?> payram(String method, String path, Map<String, Object> body) {
    var headers = new org.springframework.http.HttpHeaders();
    headers.set("API-Key", apiKey);
    headers.set("Content-Type", "application/json");
    var entity = new org.springframework.http.HttpEntity<>(body, headers);
    return restTemplate.exchange(baseUrl + path, org.springframework.http.HttpMethod.valueOf(method), entity, Map.class);
  }

  @PostMapping("/payments/create")
  public ResponseEntity<?> createPayment(@RequestBody Map<String, Object> payload) {
    Map<String, Object> body = Map.of(
        "customerEmail", "customer@example.com",
        "customerID", payload.getOrDefault("referenceId", "demo-ref"),
        "amountInUSD", payload.getOrDefault("amount", 1));
    return payram("POST", "/api/v1/payment", body);
  }

  @GetMapping("/payments/{referenceId}")
  public ResponseEntity<?> paymentStatus(@PathVariable String referenceId) {
    return payram("GET", "/api/v1/payment/reference/" + referenceId, null);
  }

  @PostMapping("/payouts/create")
  public ResponseEntity<?> createPayout(@RequestBody Map<String, Object> payload) {
    var body = new HashMap<String, Object>();
    Object customerID = payload.containsKey("customerID") ? payload.get("customerID") : payload.get("customerId");
    if (customerID == null) {
      customerID = "demo-customer-id";
    }
    body.put("customerID", customerID);
    body.put("amount", payload.getOrDefault("amount", 1));
    body.put("currencyCode", payload.getOrDefault("currencyCode", "USDT"));
    body.put("blockchainCode", payload.getOrDefault("blockchainCode", "ETH"));
    body.put("toAddress", payload.getOrDefault("toAddress", "0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef"));
    body.put("email", payload.getOrDefault("email", "merchant@example.com"));
    return payram("POST", "/api/v1/withdrawal/merchant", body);
  }

  @GetMapping("/payouts/{id}")
  public ResponseEntity<?> payoutStatus(@PathVariable String id) {
    return payram("GET", "/api/v1/withdrawal/" + id + "/merchant", null);
  }
${
  input.includeWebhooks !== false
    ? `
  @PostMapping("/payram/webhook")
  public ResponseEntity<?> webhook(
      @RequestHeader(value = "X-Payram-Signature", required = false) String signature,
      @RequestHeader(value = "X-Webhook-Test", required = false) String testFlag,
      @RequestBody String rawBody) throws Exception {
    // The signature covers the exact bytes PayRam sent, so verify the raw body.
    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(new javax.crypto.spec.SecretKeySpec(apiKey.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
    String expected = "sha256=" + java.util.HexFormat.of().formatHex(mac.doFinal(rawBody.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    if (signature == null || !java.security.MessageDigest.isEqual(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8), signature.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid-signature"));
    }

    if (!"true".equals(testFlag)) {
      System.out.println("Payram webhook payload " + rawBody);
    }
    return ResponseEntity.ok(Map.of("message", "Webhook received successfully"));
  }
`
    : ''
}
}
`,
    },
    {
      path: 'src/main/resources/templates/index.html',
      description: 'Thymeleaf-like static page for forms.',
      contents: expressFrontend,
    },
  ];

  return {
    appName,
    language: 'java',
    framework: 'spring-boot',
    instructions: 'Set PAYRAM_* env vars, run ./mvnw spring-boot:run, open http://localhost:8080.',
    files,
  };
}

export const registerScaffoldAppTool = (server: McpServer) => {
  logger.debug('Registering scaffold_payram_app tool');

  server.registerTool(
    'scaffold_payram_app',
    {
      title: 'Scaffold Payram Payments & Payouts App',
      description:
        'Generates a minimal full-stack app skeleton with Payram payments and payouts routes (and a simple UI) for a chosen language and framework.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async (args) => {
        const normalized: ScaffoldInput = {
          ...args,
          includeWebhooks: args.includeWebhooks ?? true,
        };

        const supportedFrameworks = frameworkMap[normalized.language];
        if (!supportedFrameworks || !supportedFrameworks.includes(normalized.framework)) {
          throw new Error(
            `Framework ${normalized.framework} is not available for language ${normalized.language}.`,
          );
        }

        const builder = builders[normalized.framework];
        const result = builder(normalized);

        return {
          content: [
            textContent(
              `Generated scaffold for ${result.language}/${result.framework} with ${result.files.length} files. Follow the instructions field to apply it in your workspace.`,
            ),
          ],
          structuredContent: result,
        } satisfies {
          content: ReturnType<typeof textContent>[];
          structuredContent: ScaffoldResult;
        };
      },
      { toolName: 'scaffold_payram_app' },
    ),
  );
};
