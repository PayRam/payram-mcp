// NOTE: Webhook snippets are derived from docs/payram-webhook.yaml (WebhookPayload/WebhookAck).
// If that spec changes, update it first and then refresh these templates.

export type PayramWebhookStatus =
  'OPEN' | 'CANCELLED' | 'FILLED' | 'PARTIALLY_FILLED' | 'OVER_FILLED' | 'UNDEFINED';

export interface PayramWebhookPayload {
  reference_id: string;
  invoice_id?: string;
  customer_id?: string;
  customer_email?: string;
  status: PayramWebhookStatus;
  amount?: number;
  filled_amount_in_usd?: number;
  currency?: string; // 3-letter ISO code
  [key: string]: unknown;
}

export interface PayramWebhookAck {
  message: string;
}
