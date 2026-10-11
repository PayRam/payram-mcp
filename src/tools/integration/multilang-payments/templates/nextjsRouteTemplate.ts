import { SnippetResponse } from '../../common/snippetTypes.js';

const notes = 'Wires the Payram JS SDK into a Next.js App Router handler for initiating payments.';

export const buildNextjsPaymentRouteSnippet = (): SnippetResponse => ({
  title: 'Next.js App Router endpoint for Payram create-payment',
  snippet: `import { NextRequest, NextResponse } from 'next/server';
import { Payram, InitiatePaymentRequest, isPayramSDKError } from 'payram';

if (!process.env.PAYRAM_BASE_URL || !process.env.PAYRAM_API_KEY) {
  throw new Error('PAYRAM_BASE_URL and PAYRAM_API_KEY must be configured');
}

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function POST(request: NextRequest) {
  let payload: Partial<InitiatePaymentRequest>;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  if (!payload?.customerEmail || !payload.customerId || typeof payload.amountInUSD !== 'number') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const checkout = await payram.payments.initiatePayment({
      customerEmail: payload.customerEmail,
      customerId: payload.customerId,
      amountInUSD: payload.amountInUSD,
    });

    return NextResponse.json({
      referenceId: checkout.reference_id,
      checkoutUrl: checkout.url,
      host: checkout.host,
    });
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
      });
    } else {
      console.error('Failed to create Payram payment', error);
    }
    return NextResponse.json({ error: 'payram_upstream_error' }, { status: 502 });
  }
}
`,
  meta: {
    language: 'typescript',
    framework: 'nextjs',
    filenameSuggestion: 'app/api/pay/create/route.ts',
    description: 'Next.js App Router API route that uses the Payram JS SDK to initiate payments.',
  },
  notes,
});
