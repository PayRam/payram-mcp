// NOTE: Webhook snippets are derived from docs/payram-webhook.yaml (WebhookPayload/WebhookAck).
// If that spec changes, update it first and then refresh these templates.

import { SnippetResponse } from '../../common/snippetTypes.js';

export const buildWebhookEventRouterSnippet = (): SnippetResponse => ({
  title: 'Route Payram webhook events to internal handlers',
  snippet: `import { PayramWebhookPayload } from './payramWebhookTypes';

export async function handlePayramEvent(payload: PayramWebhookPayload) {
  switch (payload.status) {
    case 'FILLED':
      await handleFilledPayment(payload);
      break;
    case 'OPEN':
      await handleOpenPayment(payload);
      break;
    case 'PARTIALLY_FILLED':
      await handlePartialPayment(payload);
      break;
    case 'OVER_FILLED':
      await handleOverfilledPayment(payload);
      break;
    case 'CANCELLED':
      await handleCancelledPayment(payload);
      break;
    case 'UNDEFINED':
    default:
      await handleUndefinedStatus(payload);
      break;
  }
}

async function handleFilledPayment(payload: PayramWebhookPayload) {
  // TODO: Mark the invoice as paid, deliver goods, and reconcile reference_id in your ledger.
  console.log('Payram payment filled', payload.reference_id);
}

async function handleOpenPayment(payload: PayramWebhookPayload) {
  // TODO: Keep the order pending but record that Payram acknowledged the request.
  console.log('Payram payment open', payload.reference_id);
}

async function handlePartialPayment(payload: PayramWebhookPayload) {
  // TODO: Update the outstanding balance and notify finance to monitor for completion.
  console.log('Payram payment partially filled', payload.reference_id);
}

async function handleOverfilledPayment(payload: PayramWebhookPayload) {
  // TODO: Queue manual review or refund the excess amount to the customer.
  console.log('Payram payment over filled', payload.reference_id);
}

async function handleCancelledPayment(payload: PayramWebhookPayload) {
  // TODO: Release inventory holds and inform the customer that payment was cancelled.
  console.log('Payram payment cancelled', payload.reference_id);
}

async function handleUndefinedStatus(payload: PayramWebhookPayload) {
  // TODO: Log for investigation. Payram may introduce additional statuses in the future.
  console.warn('Payram payment status undefined', payload.reference_id);
}
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/webhooks/handlePayramEvent.ts',
    description:
      'Routes Payram webhook events by payment status based on the WebhookPayload schema.',
  },
  notes: 'Switch statement is based on PayramWebhookStatus enum.',
});
