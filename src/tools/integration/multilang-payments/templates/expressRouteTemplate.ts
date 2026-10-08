import { SnippetResponse } from '../../common/snippetTypes.js';

const notes =
  'Uses the Payram JS SDK inside an Express router so your backend never shells out raw HTTP calls.';

export const buildExpressPaymentRouteSnippet = (): SnippetResponse => ({
  title: 'Express route for Payram create-payment API',
  snippet: `import express, { Request, Response } from 'express';
import { Payram, InitiatePaymentRequest, isPayramSDKError } from 'payram';

const router = express.Router();
router.use(express.json());

if (!process.env.PAYRAM_BASE_URL || !process.env.PAYRAM_API_KEY) {
  throw new Error('PAYRAM_BASE_URL and PAYRAM_API_KEY must be configured');
}

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

router.post('/api/pay/create', async (req: Request, res: Response) => {
  const payload = req.body as Partial<InitiatePaymentRequest>;

  if (!payload?.customerEmail || !payload.customerId || typeof payload.amountInUSD !== 'number') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  try {
    const checkout = await payram.payments.initiatePayment({
      customerEmail: payload.customerEmail,
      customerId: payload.customerId,
      amountInUSD: payload.amountInUSD,
    });

    return res.status(201).json({
      referenceId: checkout.reference_id,
      checkoutUrl: checkout.url,
      host: checkout.host,
    });
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        retryable: error.isRetryable,
      });
    } else {
      console.error('Failed to create Payram payment', error);
    }
    return res.status(502).json({ error: 'payram_upstream_error' });
  }
});

export default router;
`,
  meta: {
    language: 'typescript',
    framework: 'express',
    filenameSuggestion: 'src/routes/payramCreatePayment.ts',
    description: 'Express router that calls payram.payments.initiatePayment via the official SDK.',
  },
  notes,
});
