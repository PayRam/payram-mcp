import { MarkdownDocResponse } from '../../../types/context.js';
import { REQUIREMENTS } from '../../../facts/payram.js';

export const PAYRAM_TEST_PREP_DOC: MarkdownDocResponse = {
  title: 'Payram Test Readiness Checklist',
  description:
    'Prompts the user to confirm a self-hosted Payram server, gather credentials, and prep an environment before we scaffold a demo app.',
  sections: [
    {
      id: 'say-test-payram',
      title: 'How to start the guided test',
      markdown: `This walks through what is needed before a hands-on Payram test: a running server, the base URL and an API key. Answer the first question to begin; nothing is created or deployed until you ask for it.`,
      sources: [
        {
          id: 'welcome-to-payram',
          path: 'index.md',
          url: 'https://docs.payram.com/',
        },
      ],
    },
    {
      id: 'confirm-server',
      title: 'First question: do you already have a self-hosted Payram server?',
      markdown: `Let me know whether your self-hosted Payram instance is already live.

- **If you still need to deploy it**, follow the Quick Setup guide to provision a server (${REQUIREMENTS.server}; ${REQUIREMENTS.os}), open ports 80 and 443, and run the installer for testnet. payram_setup_plan gives the exact personalised steps, including database and SSL choices.
- **If your server is already running**, we can jump straight to collecting credentials.

Either way, settle first whether a new install is required.`,
      sources: [
        {
          id: 'deployment-guide/quick-setup',
          path: 'deployment-guide/quick-setup.md',
          url: 'https://docs.payram.com/deployment-guide/quick-setup',
        },
        {
          id: 'onboarding-guide/introduction',
          path: 'onboarding-guide/introduction.md',
          url: 'https://docs.payram.com/onboarding-guide/introduction',
        },
      ],
    },
    {
      id: 'collect-api-key',
      title: 'Grab the Base URL and API key from the dashboard',
      markdown: `After the server is reachable, sign in to the Payram dashboard and grab the credentials we'll use in code:

1. Go to **Settings → Accounts**.
2. Choose the **project/workspace** you want to integrate.
3. Open **API Keys**.
4. Click **Add New** (or copy an existing key) and keep it secret.
5. Note your hosted base URL (the domain where your Payram instance is exposed).

We'll plug both values into \`.env\` so every generated sample can authenticate using the documented \`API-Key\` header.`,
      sources: [
        {
          id: 'features/payment-apis',
          path: 'features/payment-apis.md',
          url: 'https://docs.payram.com/features/payment-apis',
        },
        {
          id: 'features/multi-brand-setup',
          path: 'features/multi-brand-setup.md',
          url: 'https://docs.payram.com/features/multi-brand-setup',
        },
      ],
    },
    {
      id: 'env-and-demo',
      title: 'Add credentials to .env and request a demo app',
      markdown: `Once you have both \`PAYRAM_BASE_URL\` and \`PAYRAM_API_KEY\`:

1. Drop them into your project's \`.env\` (or environment manager) so backend code and scaffolds can read them.
2. Tell me "create a demo app" or specify which framework you want to scaffold, and I'll generate a sample that points at your self-hosted instance.

Already running a server with valid API keys? You can skip straight here: update \`.env\`, ask me for a demo, and we'll wire payments, payouts, and webhooks against your environment.`,
      sources: [
        {
          id: 'payram-sdk/typescript-javascript-sdk',
          path: 'payram-sdk/typescript-javascript-sdk.md',
          url: 'https://docs.payram.com/payram-sdk/typescript-javascript-sdk',
        },
      ],
    },
  ],
  notes:
    'Use this checklist whenever a user says "test payram" so they gather infrastructure + credentials before requesting a scaffold.',
};
