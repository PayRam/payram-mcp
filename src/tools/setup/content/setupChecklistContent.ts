import type { SetupChecklistResponse } from '../../../types/setup.js';
import { CONTAINER, INSTALL, REQUIREMENTS, SMART_BRIDGE, WEBHOOK } from '../../../facts/payram.js';

export const PAYRAM_SETUP_CHECKLIST: SetupChecklistResponse = {
  title: 'PayRam setup checklist',
  description:
    'From an empty server to a hardened gateway taking payments. For a personalised, command-level plan call payram_setup_plan.',
  items: [
    {
      id: 'server',
      label: 'Server, domain and firewall',
      description: `${REQUIREMENTS.server}; ${REQUIREMENTS.os}. Point your domain at it. ${CONTAINER.firewall}`,
      docsRefs: ['deployment-guide/quick-setup.md'],
    },
    {
      id: 'install',
      label: 'Install PayRam (interactive once)',
      description: `${INSTALL.installer} --testnet (or --mainnet). ${INSTALL.ttyRule}`,
      docsRefs: ['deployment-guide/quick-setup.md'],
    },
    {
      id: 'root-account',
      label: 'Create the root account right away',
      description:
        'The first sign-up becomes root. Create it immediately after install, then back up the credentials and the ~/.payraminfo folder (AES key).',
      docsRefs: ['onboarding-guide/root-account-setup.md'],
    },
    {
      id: 'site-url',
      label: 'Set the public site URL',
      description:
        'Open the dashboard on your public domain and save Settings → Site URL. Payment links, emails and webhook origin use it.',
    },
    {
      id: 'wallets',
      label: 'Deposit wallets and cold wallet',
      description:
        'Deploy the smart-contract deposit wallet (USDC on Base is the fastest start; needs a little gas) and/or a BTC xpub wallet. Choose the cold wallet the contracts sweep to. Keep the master/deployer mnemonic offline.',
      docsRefs: ['onboarding-guide/wallet-integration.md', 'onboarding-guide/hot-wallet-setup.md'],
    },
    {
      id: 'payment-options',
      label: 'Review payment options and Smart Bridge rails',
      description: `${SMART_BRIDGE.defaults} ${SMART_BRIDGE.merchantImpact}`,
    },
    {
      id: 'smtp',
      label: 'SMTP for emails and OTP',
      description:
        'Configure SMTP so password resets, payment emails and payout OTPs are delivered.',
      docsRefs: ['deployment-guide/advanced-setup.md'],
      optional: true,
    },
    {
      id: 'api-key-and-webhook',
      label: 'API key and webhook',
      description: `Create the project API key for your backend and register your webhook URL. Deliveries carry ${WEBHOOK.signature}. ${WEBHOOK.verify}`,
    },
    {
      id: 'test',
      label: 'Test end to end',
      description:
        'Create a payment link, pay it on testnet (or preview with &test=true), confirm the webhook and the sweep to the cold wallet.',
      docsRefs: ['onboarding-guide/testing-payment-links.md'],
    },
    {
      id: 'operate',
      label: 'Backups, SSL renewal, daily checks',
      description:
        'Back up the database together with ~/.payraminfo, make certificate renewal work, and run a daily check (payram_runbook "backup", "ssl_renewal_fix"; payram_ops_playbook "daily_check").',
    },
  ],
  notes:
    'Anything that moves money, changes ownership (cold wallet, fees) or wipes data needs the human.',
};
