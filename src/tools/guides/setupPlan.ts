import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { safeHandler } from '../common/errors.js';
import { textContent } from '../common/content.js';
import { WHO_LABEL, renderStepLines, type Who } from './render.js';
import {
  CONTAINER,
  DASHBOARD_PAGES,
  HUMAN_ONLY,
  INSTALL,
  NETWORK,
  REQUIREMENTS,
  SETUP_MODE,
  SMART_BRIDGE,
  WEBHOOK,
} from '../../facts/payram.js';

/**
 * payram_setup_plan — a personalised, ordered plan to get from "nothing"
 * to "first working payment link" (and hardened), with who does each step
 * (agent shell / human / dashboard), the exact command, what success looks
 * like, and the hard stops that need a human.
 *
 * Content follows the payram-scripts agent flow (setup_payram_agents.sh)
 * and the verified single-container deployment (core 3.8.1).
 */

const executorEnum = z.enum(Object.keys(WHO_LABEL) as [Who, ...Who[]]);
type Executor = Who;

const stepSchema = z.object({
  id: z.string(),
  title: z.string(),
  executor: executorEnum,
  commands: z.string().optional(),
  expect: z.string().optional(),
  gate: z.string().optional().describe('Why the agent must stop and get the human here'),
  notes: z.array(z.string()).optional(),
});

const phaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.array(stepSchema),
});

type Step = z.infer<typeof stepSchema>;
type Phase = z.infer<typeof phaseSchema>;

const STAGES = [
  'fresh',
  'installed',
  'account_created',
  'wallet_ready',
  'payment_link_created',
] as const;
type Stage = (typeof STAGES)[number];

const inputSchema = z.object({
  path: z
    .enum(['agent', 'human'])
    .default('agent')
    .describe(
      'agent = headless CLI after a one-time interactive install; human = installer + web dashboard',
    ),
  network: z
    .enum(['testnet', 'mainnet'])
    .default('testnet')
    .describe('testnet = free test coins (recommended first); mainnet = real money'),
  domain: z
    .string()
    .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i, 'hostname only, e.g. pay.example.com')
    .optional()
    .describe(
      'Public hostname for the gateway, e.g. pay.example.com. Omit if you only have an IP for now.',
    ),
  ssl: z
    .enum(['letsencrypt', 'own_certificate', 'proxy', 'none'])
    .optional()
    .describe(
      'letsencrypt (needs domain), own_certificate, proxy (Cloudflare/your own reverse proxy terminates TLS), none. Default: letsencrypt with a domain, none without.',
    ),
  role: z
    .enum(['merchant', 'operator'])
    .default('merchant')
    .describe(`merchant: ${SETUP_MODE.merchant} operator: ${SETUP_MODE.operator}`),
  wallet: z
    .enum(['usdc_base', 'btc', 'both'])
    .default('usdc_base')
    .describe(
      'First deposit wallet: usdc_base (smart-contract wallet on Base, needs a little gas), btc (xpub, no gas), or both',
    ),
  stage: z
    .enum(STAGES)
    .default('fresh')
    .describe('Where you are now; the plan starts from the next step'),
  integration: z
    .enum(['none', 'website', 'shopify', 'woocommerce'])
    .default('none')
    .describe('What will take payments once the gateway is up'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  summary: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  phases: z.array(phaseSchema),
  humanDecisions: z.array(z.string()),
  warnings: z.array(z.string()),
  nextTools: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

const step = (
  id: string,
  title: string,
  executor: Executor,
  rest: Omit<Step, 'id' | 'title' | 'executor'> = {},
): Step => ({
  id,
  title,
  executor,
  ...rest,
});

export const buildSetupPlan = (raw: Partial<Input>): Output => {
  const input = inputSchema.parse(raw);
  const { path, network, domain, role, wallet, stage, integration } = input;
  const ssl = input.ssl ?? (domain ? 'letsencrypt' : 'none');
  const agent = path === 'agent';
  const mainnet = network === 'mainnet';
  const publicUrl = domain
    ? `${ssl === 'none' ? 'http' : 'https'}://${domain}`
    : 'http://<server-ip>';
  const netFlag = NETWORK.flags[network];
  const warnings: string[] = [];
  const phases: Phase[] = [];
  /** Has the user not yet reached this stage? (The plan resumes after `stage`.) */
  const before = (next: Stage) => STAGES.indexOf(stage) < STAGES.indexOf(next);

  if (ssl === 'letsencrypt' && !domain) {
    warnings.push(
      'Let\'s Encrypt needs a domain that points at this server. Add a domain or choose ssl "none"/"proxy" for now.',
    );
  }
  if (!domain) {
    warnings.push(
      'Without a domain, customers will see http://<server-ip> in payment links. Fine for testing; use a domain with HTTPS before taking real payments.',
    );
  }
  if (mainnet) {
    warnings.push(
      'Mainnet spends real money (gas) and takes real payments. Prefer a testnet dry run first, on a separate server.',
    );
  }
  if (ssl === 'none' && mainnet) {
    warnings.push(
      'Taking mainnet payments over plain HTTP is not recommended. Set up HTTPS (payram_runbook task "ssl_setup").',
    );
  }

  // ── Phase 1: prepare the server ────────────────────────────────────
  if (before('installed')) {
    const prep: Step[] = [
      step('server', 'Get a server', 'human', {
        notes: [
          `Minimum: ${REQUIREMENTS.server}. ${REQUIREMENTS.os}.`,
          REQUIREMENTS.diskFloor,
          'You need SSH access as root or a sudo user.',
        ],
      }),
    ];
    if (domain) {
      prep.push(
        step('dns', `Point ${domain} at the server`, 'human', {
          notes: [
            'Create an A record (and AAAA if the server has IPv6) for the hostname → server IP.',
          ],
          commands: `dig +short ${domain}    # must print the server's public IP`,
          expect: "The server IP. Let's Encrypt fails until DNS resolves.",
        }),
      );
    }
    prep.push(
      step('firewall', 'Open only 22, 80 and 443', 'agent_shell', {
        commands: `sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
sudo ss -ltnp | grep -E ':(80|443)\\b' || echo "80/443 are free"`,
        expect: '80 and 443 free before install (nothing else listening on them).',
        notes: [
          CONTAINER.firewall,
          'Docker-published ports bypass ufw, so also configure the cloud provider firewall (security group) to allow only 22/80/443.',
        ],
      }),
    );
    phases.push({ id: 'prepare', title: 'Prepare the server', steps: prep });
  }

  // ── Phase 2: install ───────────────────────────────────────────────
  if (before('installed')) {
    const sslAnswer: Record<typeof ssl, string> = {
      letsencrypt: `choose Let's Encrypt and enter ${domain ?? '<your-domain>'} (needs DNS pointing here and ports 80/443 free)`,
      own_certificate: `choose custom certificate; files must be at /etc/letsencrypt/live/${domain ?? '<domain>'}/fullchain.pem and privkey.pem`,
      proxy:
        'choose no SSL / external TLS; your proxy must forward to http://<server>:80 and set X-Forwarded-Proto: https',
      none: 'choose no SSL (you can add it later with the installer menu "Update SSL Configuration")',
    };
    const installCmd = agent
      ? `${INSTALL.agentCli} ${netFlag}${role === 'operator' ? ' --operator' : ''}${wallet === 'btc' ? ' --skip-scw' : ''}`
      : `${INSTALL.installer} ${netFlag}`;
    const envLines: string[] = [];
    if (agent && mainnet && wallet !== 'btc') {
      envLines.push(
        "export PAYRAM_FUND_COLLECTOR=0x...       # the human's COLD wallet address (sweep destination) — human decision",
        'export PAYRAM_ACCEPT_MAINNET_COSTS=1    # only after the human agreed to spend ~$10 of gas',
      );
    }
    if (agent && role === 'operator') {
      envLines.push(
        'export PAYRAM_OPERATOR_EVM_FEE_COLLECTOR=0x...   # operator fee collector — human decision',
        'export PAYRAM_OPERATOR_BTC_FEE_COLLECTOR=bc1...  # if BTC is used — human decision',
        "export PAYRAM_OPERATOR_FEE_BPS=<bps>             # operator's fee in basis points (max 1500)",
      );
    }
    phases.push({
      id: 'install',
      title: agent ? 'Install PayRam and run the headless agent flow' : 'Install PayRam',
      steps: [
        step(
          'install',
          agent ? 'Run the one-step agent flow (interactive once)' : 'Run the installer',
          'agent_shell',
          {
            commands: `# ${INSTALL.ttyRule}
ssh -t root@<server>
${envLines.length ? `${envLines.join('\n')}\n` : ''}${installCmd}`,
            expect: agent
              ? 'Installer questions, then: root account created, site URL set, wallet flow, a payment link printed, API key saved to ~/.payraminfo/merchant-api-key.env.'
              : 'Installer finishes with the dashboard URL. Health check passes.',
            notes: [
              'Installer questions: database → keep the containerized default unless you run your own Postgres; SSL → ' +
                sslAnswer[ssl] +
                '; port → 80.',
              `Network is ${network} (${netFlag}). The installer default without a flag is ${NETWORK.installerDefault}, so always pass the flag. ${NETWORK.switchRule}`,
              'Never use `curl … | bash`: it has no terminal, so a fresh install exits.',
              agent && wallet !== 'btc'
                ? `The flow deploys a smart-contract deposit wallet on Base and pauses until the deployer address it prints holds gas (${mainnet ? '~$10 of ETH on Base or Ethereum' : 'Base Sepolia ETH from a faucet, e.g. https://www.alchemy.com/faucets/base-sepolia'}). Relay that address to the human.`
                : 'The BTC-only lane (--skip-scw) creates an xpub wallet instantly and needs no gas; add a Base wallet later for USDC.',
              ...(agent
                ? [
                    'Back up ~/.payraminfo/headless-wallet-secret.txt (deployer mnemonic) offline: it is needed to deploy more chains and to change the cold-wallet config on-chain.',
                    'Leave the Analytics MCP server off (add --skip-mcp-server) unless you need it; if anything listens on port 3333, firewall it.',
                  ]
                : []),
            ].filter(Boolean) as string[],
            gate:
              agent && mainnet
                ? 'Mainnet: the human must provide the cold wallet address and approve the gas spend before this runs.'
                : undefined,
          },
        ),
        step('verify_install', 'Verify the gateway answers', 'agent_shell', {
          commands: `curl -s http://localhost/api/v1/health | jq '{status, version}'     # on the server
curl -s ${publicUrl}/api/v1/health | jq '{status, version}'            # from outside
docker port ${CONTAINER.name}                                          # expect only 80 (and 443)`,
          expect: 'status "ok" from both; only 80/443 published.',
          notes: [
            'Or call payram_doctor with baseUrl = ' +
              publicUrl +
              ' for a public, credential-free check.',
          ],
        }),
      ],
    });
  }

  // ── Phase 3: account + site URL ────────────────────────────────────
  if (before('account_created')) {
    phases.push({
      id: 'account',
      title: 'Claim the admin account and fix the public URL',
      steps: [
        step(
          'claim_root',
          'Create the root account immediately',
          agent ? 'agent_shell' : 'human_dashboard',
          {
            commands: agent
              ? `# The one-step flow already ran "setup" (root credentials saved, chmod 600):
cat ~/.payraminfo/root-credentials.env   # hand these to the human over a private channel`
              : `open ${publicUrl} and sign up`,
            notes: [
              'The first person to sign up becomes root. Do this right after install, before the server is advertised anywhere.',
              'The human should sign in and change the root password in the dashboard.',
            ],
            gate: agent
              ? 'Hand the root credentials to the human privately; never paste them into a chat log.'
              : undefined,
          },
        ),
        step('site_url', `Set the site URL to ${publicUrl}`, 'human_dashboard', {
          commands: `open ${publicUrl} → sign in as root → ${DASHBOARD_PAGES.siteUrl} → Save`,
          expect: `payram_ops_playbook task "site_url" shows ${publicUrl}.`,
          notes: [
            'Payment links, emails and webhook origin use this URL. A headless install sets it to http://localhost because the agent talks to the API on the server itself; customers cannot open those links.',
            'The URL is taken from the page you save it on, so save it while browsing the public domain.',
          ],
          gate: 'Root-only and must be done in a browser on the public domain.',
        }),
      ],
    });
  }

  // ── Phase 4: role (operator only) ──────────────────────────────────
  if (role === 'operator' && before('wallet_ready')) {
    phases.push({
      id: 'operator',
      title: 'Operator mode (platform for other merchants)',
      steps: [
        step(
          'setup_mode',
          'Set the install role to operator before any project exists',
          agent ? 'agent_shell' : 'human_dashboard',
          {
            commands: agent
              ? `${INSTALL.agentCmd('setup-mode operator')}\n${INSTALL.agentCmd('ensure-operator-config')}`
              : 'Dashboard role wizard → Operator',
            notes: [SETUP_MODE.operator, SETUP_MODE.operatorFees],
            gate: "Fee collector addresses and the fee rate are the operator's business decisions.",
          },
        ),
      ],
    });
  }

  // ── Phase 5: wallet ────────────────────────────────────────────────
  if (before('wallet_ready')) {
    const wsteps: Step[] = [];
    if (wallet === 'usdc_base' || wallet === 'both') {
      wsteps.push(
        step(
          'scw',
          'Deposit wallet for USDC on Base (smart-contract wallet)',
          agent ? 'agent_shell' : 'human_dashboard',
          {
            commands: agent
              ? `PAYRAM_BLOCKCHAIN_CODE=BASE ${INSTALL.agentCmd('deploy-scw-flow')}   # skip if the one-step flow already deployed it`
              : 'Dashboard → Wallets → add a deposit wallet for Base',
            expect: 'SCW registered and linked to the project.',
            notes: [
              'No deposit keys are stored on the server: deposits are swept by the smart contract to the cold wallet.',
              mainnet
                ? 'Mainnet requires PAYRAM_FUND_COLLECTOR (cold wallet) and PAYRAM_ACCEPT_MAINNET_COSTS=1.'
                : 'Testnet: fund the printed deployer address with Base Sepolia ETH.',
              `More EVM chains later: PAYRAM_BLOCKCHAIN_CODE=ETH (or POLYGON) ${INSTALL.agentCmd('deploy-scw')}`,
            ],
            gate: mainnet ? 'Gas spend and cold-wallet address need the human.' : undefined,
          },
        ),
      );
    }
    if (wallet === 'btc' || wallet === 'both') {
      wsteps.push(
        step(
          'btc',
          'Bitcoin deposit wallet (xpub, no gas)',
          agent ? 'agent_shell' : 'human_dashboard',
          {
            commands: agent
              ? INSTALL.agentCmd('ensure-wallet')
              : 'Dashboard → Wallets → add a BTC wallet',
            notes: [
              'Keep the generated wallet secret offline; BTC sweeps are signed in the PayRam Connect mobile app.',
            ],
          },
        ),
      );
    }
    wsteps.push(
      step('rails', 'Review Smart Bridge payment options', 'human_dashboard', {
        commands: `${DASHBOARD_PAGES.paymentOptions}   (or payram_ops_playbook task "payment_options")`,
        notes: [
          `Rails: ${SMART_BRIDGE.rails.map((r) => r.origin).join(', ')}; they settle as ${SMART_BRIDGE.settlesAs}. ${SMART_BRIDGE.requires}`,
          SMART_BRIDGE.defaults,
          SMART_BRIDGE.merchantImpact,
        ],
      }),
    );
    phases.push({ id: 'wallet', title: 'Deposit wallets', steps: wsteps });
  }

  // ── Phase 6: first payment ─────────────────────────────────────────
  if (before('payment_link_created')) {
    phases.push({
      id: 'first_payment',
      title: 'API key and first payment link',
      steps: [
        step('api_key', 'Get the project API key', agent ? 'agent_shell' : 'human_dashboard', {
          commands: agent
            ? `${INSTALL.agentCmd('ensure-api-key')}\n# saved to ~/.payraminfo/merchant-api-key.env (chmod 600)`
            : `${DASHBOARD_PAGES.apiKeys} → create key`,
          notes: [
            'The key authorises payment creation AND payouts: keep it server-side, never in browser code or chat.',
            `merchant-api-key.env records a localhost base URL; from other machines use ${publicUrl}.`,
          ],
        }),
        step(
          'payment_link',
          'Create a test payment link',
          agent ? 'agent_shell' : 'human_dashboard',
          {
            commands: agent
              ? INSTALL.agentCmd('create-payment-link')
              : `payram_ops_playbook task "create_payment_link"`,
            expect: `A URL starting with ${publicUrl}. If it starts with http://localhost, redo the site URL step.`,
            notes: [
              NETWORK.testModeRule,
              "Use a real, unique customer id: a new link cancels that customer's other open links.",
            ],
          },
        ),
      ],
    });
  }

  // ── Phase 7: harden ────────────────────────────────────────────────
  const harden: Step[] = [
    step('doctor', 'Run the public health check', 'agent_http', {
      commands: `payram_doctor { "baseUrl": "${publicUrl}" }`,
      expect: 'Reachable, healthy, version current, certificate valid.',
    }),
    step('backup', 'Set up backups (database + AES key)', 'agent_shell', {
      commands: 'payram_runbook { "task": "backup" }',
      notes: [CONTAINER.aesKey],
    }),
    step('daily', 'Adopt the daily check', 'agent_shell', {
      commands: 'payram_ops_playbook { "task": "daily_check" }',
    }),
  ];
  if (ssl === 'letsencrypt') {
    harden.splice(
      1,
      0,
      step('ssl_renewal', 'Make certificate renewal work', 'agent_shell', {
        commands: 'payram_runbook { "task": "ssl_renewal_fix" }',
        notes: [
          "The installer's renewal cron cannot bind port 80 while PayRam holds it; without the fix certificates lapse after ~90 days.",
        ],
      }),
    );
  }
  phases.push({ id: 'harden', title: 'Harden and operate', steps: harden });

  // ── Phase 8: integrate ─────────────────────────────────────────────
  if (integration !== 'none') {
    const integrate: Record<Exclude<typeof integration, 'none'>, Step> = {
      website: step('integrate', 'Integrate checkout into your app', 'agent_http', {
        commands:
          'generate_payment_route_snippet / generate_webhook_handler (or scaffold_payram_app) for your framework',
        notes: [
          'Create payments server-side with the API key; redirect the customer to the returned url.',
          `Webhooks carry ${WEBHOOK.signature}. ${WEBHOOK.verify}`,
        ],
      }),
      shopify: step('integrate', 'Connect Shopify', 'agent_shell', {
        commands: 'payram_runbook { "task": "shopify_connector" }',
      }),
      woocommerce: step('integrate', 'Connect WooCommerce', 'human', {
        commands: 'payram_runbook { "task": "woocommerce_plugin" }',
      }),
    };
    phases.push({
      id: 'integrate',
      title: 'Take payments from your store/app',
      steps: [integrate[integration]],
    });
  }

  const summary = [
    `${agent ? 'Headless agent' : 'Human'} setup on ${network}${domain ? ` for ${publicUrl}` : ''} (${role}, first wallet: ${wallet.replace('_', ' ')}).`,
    `Steps marked human/human_dashboard or with a gate need the human; everything else the agent can run over SSH.`,
    stage !== 'fresh' ? `Starting after stage "${stage}".` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    summary,
    inputs: { ...input, ssl },
    phases,
    humanDecisions: [...HUMAN_ONLY],
    warnings,
    nextTools: ['payram_doctor', 'payram_ops_playbook', 'payram_runbook'],
  };
};

export const renderSetupPlan = (plan: Output): string => {
  const lines = [`# PayRam setup plan`, plan.summary, ''];
  if (plan.warnings.length) {
    lines.push('Warnings:', ...plan.warnings.map((w) => `- ${w}`), '');
  }
  let n = 1;
  for (const phase of plan.phases) {
    lines.push(`## ${phase.title}`);
    for (const s of phase.steps) {
      lines.push(
        ...renderStepLines({ ...s, heading: `${n++}. **${s.title}** — ${WHO_LABEL[s.executor]}` }),
      );
    }
    lines.push('');
  }
  lines.push('Never do these without the human:', ...plan.humanDecisions.map((d) => `- ${d}`));
  return lines.join('\n');
};

export const registerSetupPlanTool = (server: McpServer) => {
  server.registerTool(
    'payram_setup_plan',
    {
      title: 'Plan a PayRam install (step by step)',
      description:
        'Start here to install PayRam on a VPS. Returns an ordered, personalised plan — prepare server → install → claim admin + set public URL → wallets (incl. Smart Bridge review) → API key + first payment link → hardening → store/app integration — with who runs each step (agent shell vs human/dashboard), exact commands, what success looks like, and hard stops that need the human (cold wallet, mainnet spend, root-only settings). Pass stage to resume mid-way.',
      inputSchema: inputSchema,
      outputSchema,
    },
    safeHandler(
      async (args: Input) => {
        const plan = buildSetupPlan(args);
        return {
          content: [textContent(renderSetupPlan(plan))],
          structuredContent: plan,
        };
      },
      { toolName: 'payram_setup_plan' },
    ),
  );
};
