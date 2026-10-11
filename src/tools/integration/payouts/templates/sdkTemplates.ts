// NOTE: These payout SDK snippets are derived from docs/js-sdk.md and payram-external.yaml.
// If the SDK changes, update those docs first and then refresh these templates.
import { SnippetResponse } from '../../common/snippetTypes.js';

export const buildNodeSdkCreatePayoutSnippet = (): SnippetResponse => ({
  title: 'Create a Payram payout using the Node SDK',
  snippet: `import {
  Payram,
  CreatePayoutRequest,
  MerchantPayout,
  isPayramSDKError,
} from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
  // ignore if advanced configuration is not needed
  config: {
    timeoutMs: 10_000, // optional for advance configuration
    maxRetries: 2, // optional for advance configuration
    retryPolicy: 'safe', // optional for advance configuration
    allowInsecureHttp: false, // optional for advance configuration
  },
});

export async function createPayout(payload: CreatePayoutRequest): Promise<MerchantPayout> {
  try {
    const payout = await payram.payouts.createPayout(payload);
    console.log('Queued payout:', payout.id, payout.status);
    return payout;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        isRetryable: error.isRetryable,
      });
    }
    throw error;
  }
}

// Example invocation per MerchantPayoutFromMerchantCreateRequest.
// This is the DIRECT (single-shot) payout — no OTP, no saved beneficiary.
// For repeat payments to the same destination, prefer the OTP-verified
// recipient flow (see generate_payout_recipient_flow_snippet).
await createPayout({
  email: 'merchant@example.com',
  blockchainCode: 'ETH', // UPPERCASE chain code: ETH | BTC | TRX | BASE | POLYGON
  currencyCode: 'USDC', // uppercase ticker: ETH | BTC | USDC | USDT | POL | TRX | CBBTC
  amount: '125.50',
  toAddress: '0xfeedfacecafebeefdeadbeefdeadbeefdeadbeef',
  customerID: 'cust_123',
  mobileNumber: '+15555555555',
  residentialAddress: '1 Market St, San Francisco, CA',
});
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/payouts/createPayout.ts',
    description:
      'Direct (no-OTP) payout via payram.payouts.createPayout → POST /api/v1/withdrawal/merchant.',
  },
  notes:
    'Direct payout: no saved recipient, no OTP. `blockchainCode` is the UPPERCASE chain code (ETH, BTC, TRX, BASE, POLYGON); `currencyCode` is the uppercase ticker. `amount` must be a string to preserve decimal precision. For reusable, OTP-audited beneficiaries use the recipient flow snippet instead.',
});

export const buildNodeSdkPayoutStatusSnippet = (): SnippetResponse => ({
  title: 'Fetch a Payram payout status using the Node SDK',
  snippet: `import { Payram, MerchantPayout, isPayramSDKError } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function getPayoutStatus(payoutId: number): Promise<MerchantPayout> {
  if (!payoutId) {
    throw new Error('A numeric payoutId from the createPayout response is required.');
  }

  try {
    const payout = await payram.payouts.getPayoutById(payoutId);
    console.log('Current payout status:', payout.status);
    return payout;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        isRetryable: error.isRetryable,
      });
    }
    throw error;
  }
}

await getPayoutStatus(120);
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/payouts/getPayoutStatus.ts',
    description: 'Wraps payram.payouts.getPayoutById to inspect payout.status / transfer details.',
  },
  notes:
    'Valid statuses include pending-otp-verification, pending-approval, pending, initiated, sent, failed, rejected, processed, and cancelled as documented in payouts-status.md.',
});

export const buildRecipientPayoutFlowSnippet = (): SnippetResponse => ({
  title: 'Payram 3-step recipient payout flow (create recipient → verify OTP → pay out)',
  snippet: `// The recommended payout flow for repeat beneficiaries.
// The OTP step is out-of-band: PayRam emails a 6-digit code to the API-key
// owner's email. The JS SDK has no recipient/OTP methods, so we call the
// REST endpoints directly with the 'API-Key' header.

const HOST = process.env.PAYRAM_BASE_URL!.replace(/\\/+$/, '');
const API_KEY = process.env.PAYRAM_API_KEY!;
const PROJECT_ID = Number(process.env.PAYRAM_PROJECT_ID); // your project id

const headers = {
  'API-Key': API_KEY, // NOT 'Authorization: Bearer' — merchant endpoints use API-Key
  'Content-Type': 'application/json',
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(\`\${HOST}/api/v1\${path}\`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // 403 → key missing write_recipient/write_validate_otp/write_merchant_withdrawal
    // 409 → duplicate recipient (same address+chain) or insufficient balance
    throw new Error(\`Payram \${method} \${path} failed: \${res.status} \${await res.text()}\`);
  }
  return res.json() as Promise<T>;
}

// Step 1 — Create recipient (status: pending-otp-verification). Triggers an OTP email.
const { recipient } = await call<{ recipient: { id: number; status: string } }>(
  'POST',
  '/recipients',
  {
    name: 'Acme Supplier Ltd',
    email: 'supplier@acme.example',
    blockchainCode: 'ETH', // UPPERCASE chain code: ETH | BTC | TRX | BASE | POLYGON
    address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
    projectIDs: [PROJECT_ID], // required, min 1
  },
);
console.log(\`Created recipient \${recipient.id} (\${recipient.status}). Check operator email for OTP.\`);

// Step 2 — Validate the OTP from the operator's inbox (10-minute validity, single use).
// If it expires: POST /otp/entity/{recipient.id}/purpose/recipient to regenerate.
const otpCode = await promptUserForOtp(); // your own UI / CLI / inbox-reading workflow
await call<{ message: string }>('POST', '/otp/validate', {
  entityID: recipient.id,
  scope: 'recipient', // literal string
  otpCode,
});
console.log('OTP verified — recipient is now active.');

// Step 3 — Create the payout against the verified recipient.
const withdrawal = await call<{ id: number; status: string }>(
  'POST',
  \`/project/\${PROJECT_ID}/admin/withdrawal\`,
  {
    currencyCode: 'ETH', // uppercase ticker: ETH | BTC | USDC | USDT | POL | TRX | CBBTC
    amount: '0.05', // decimal string; respect the currency's max decimals (8 BTC, 18 ETH/ERC-20)
    recipientID: recipient.id, // must be in 'active' status
  },
);
console.log(\`Payout queued: \${withdrawal.id} (\${withdrawal.status}).\`);
// Poll GET /api/v1/project/\${PROJECT_ID}/withdrawal/\${withdrawal.id} or use webhooks to track it.
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/payouts/recipientPayoutFlow.ts',
    description:
      'Raw-HTTP 3-step payout: POST /recipients → POST /otp/validate → POST /project/{projectID}/admin/withdrawal.',
  },
  notes:
    'Saved-recipient flow. Requires API-key permissions write_recipient, write_validate_otp, write_merchant_withdrawal. The OTP is emailed to the API-key owner (not returned by the API), so plan a human or inbox-reading step. Recipients are project-scoped via projectIDs; confirm status is "active" before paying out. Uses fetch (not the SDK) because payram.payouts exposes no recipient/OTP methods.',
});
