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
  amount?: string; // decimal string
  filled_amount?: string; // decimal string
  filled_amount_in_usd?: string; // decimal string
  currency?: string; // crypto ticker, e.g. USDC
  timestamp?: number; // unix seconds
  confirmation_current?: number;
  confirmation_required?: number;
  payment_info?: {
    source_address?: string;
    transaction_hash?: string;
    destination_address?: string;
    block_number?: number;
  }[];
  [key: string]: unknown;
}

export interface PayramWebhookAck {
  message: string;
}
