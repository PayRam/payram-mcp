// NOTE: These SDK snippets are derived from docs/js-sdk.md.
// If the SDK API changes, update that doc first and then refresh these templates.
import { SnippetResponse } from '../types.js';

export const buildNodeSdkCreatePaymentSnippet = (): SnippetResponse => ({
  title: 'Create a Payram payment using the Node SDK',
  snippet: `import { Payram, InitiatePaymentRequest, InitiatePaymentResponse, isPayramSDKError } from 'payram';

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

export async function createCheckout(payload: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
  try {
    const checkout = await payram.payments.initiatePayment(payload);
    console.log('Redirect customer to:', checkout.url);
    return checkout;
  } catch (error) {

    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        retryable: error.isRetryable,
      });
    }
    throw error;
  }
}

// Example invocation
await createCheckout({
  customerEmail: 'customer@example.com',
  customerId: 'cust_123',
  amountInUSD: 49.99,
});
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/payments/createPayment.ts',
    description: 'Create a Payram payment using the official JS/TS SDK.',
  },
  notes:
    'Populate InitiatePaymentRequest fields (customerEmail, customerId, amountInUSD, etc.) before redirecting customers to checkout.url.',
});

export const buildNodeSdkPaymentStatusSnippet = (): SnippetResponse => ({
  title: 'Check Payram payment status with the Node SDK',
  snippet: `import { Payram, PaymentRequestData, isPayramSDKError } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function getPaymentStatus(referenceId: string): Promise<PaymentRequestData> {
  if (!referenceId) {
    throw new Error('referenceId is required to fetch a Payram payment.');
  }

  try {
    const payment = await payram.payments.getPaymentRequest(referenceId);
    console.log('Latest payment state:', payment.paymentState);
    return payment;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        errorCode: error.error,
        requestId: error.requestId,
      });
    }
    throw error;
  }
}
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/payments/paymentStatus.ts',
    description: 'Fetch payment status using payram.payments.getPaymentRequest.',
  },
  notes:
    'Store the reference_id returned from initiatePayment and pass it to getPaymentStatus to read paymentState (OPEN, FILLED, etc.).',
});
