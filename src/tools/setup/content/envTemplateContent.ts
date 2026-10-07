import type { EnvTemplateResponse } from '../../../types/setup.js';
import { WEBHOOK } from '../../../facts/payram.js';

export const PAYRAM_ENV_TEMPLATE: EnvTemplateResponse = {
  title: 'PayRam .env template (merchant backend)',
  description:
    'Environment variables for a merchant backend that creates payments on its own self-hosted PayRam and receives signed webhooks.',
  envExample: `# Your PayRam server: the same URL as the dashboard (no :8080)
PAYRAM_BASE_URL=https://pay.example.com

# Project API key (Project → API keys, or \`setup_payram_agents.sh ensure-api-key\`).
# Server-side only: this key can also create payouts.
PAYRAM_API_KEY=replace_me
`,
  variables: [
    {
      key: 'PAYRAM_BASE_URL',
      required: true,
      description:
        'Public URL of your PayRam server, same origin as the dashboard (API under /api/v1). Use https in production. On the PayRam server itself http://localhost also works.',
      example: 'https://pay.example.com',
      docsRefs: ['deployment-guide/quick-setup.md'],
    },
    {
      key: 'PAYRAM_API_KEY',
      required: true,
      description: `Project API key, sent as the API-Key header when creating payments. PayRam also signs webhooks with it (${WEBHOOK.signature}; the key is ${WEBHOOK.signingKey}), so the same value verifies webhooks. Keep it server-side; it can create payouts.`,
      example: '32 hex characters',
      docsRefs: ['faqs/configuration-faqs.md'],
    },
  ],
  notes:
    'Never commit .env files or expose the API key to browsers. Rotating the key? Update the webhook receiver at the same time (payram_runbook "rotate_api_key").',
};
