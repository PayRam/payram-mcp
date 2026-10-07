import { describe, expect, it } from 'vitest';
import { buildSetupPlan, renderSetupPlan } from '../src/tools/guides/setupPlan.js';
import {
  OPS_TASKS,
  PLAYBOOK_FOR_TOOL,
  getRecipe,
  renderRecipe,
  teachDirectApi,
} from '../src/tools/guides/opsPlaybook.js';
import { RUNBOOK_TASKS, getRunbook, renderRunbook } from '../src/tools/guides/runbooks.js';
import { buildInstructions } from '../src/mcp/createServer.js';
import { PAYRAM_ENV_TEMPLATE } from '../src/tools/setup/content/envTemplateContent.js';
import { PAYRAM_SETUP_CHECKLIST } from '../src/tools/setup/content/setupChecklistContent.js';

const PLAN_VARIANTS = [
  {},
  { network: 'mainnet' as const, domain: 'pay.example.com' },
  { path: 'human' as const, domain: 'pay.example.com', ssl: 'proxy' as const },
  { role: 'operator' as const, wallet: 'both' as const },
  { wallet: 'btc' as const, integration: 'shopify' as const },
  { integration: 'woocommerce' as const, stage: 'installed' as const },
  { integration: 'website' as const, stage: 'wallet_ready' as const },
];

const allGuideText = (): string =>
  [
    ...PLAN_VARIANTS.map((v) => renderSetupPlan(buildSetupPlan(v))),
    ...OPS_TASKS.map((t) => renderRecipe(getRecipe(t))),
    ...RUNBOOK_TASKS.map((t) => renderRunbook(getRunbook(t))),
    buildInstructions(),
    JSON.stringify(PAYRAM_ENV_TEMPLATE),
    JSON.stringify(PAYRAM_SETUP_CHECKLIST),
  ].join('\n');

describe('truth lint over served guidance', () => {
  const text = allGuideText();

  // [label, forbidden pattern, optional allow-pattern for lines that name it only to forbid it]
  it.each<[string, RegExp, RegExp?]>([
    ['piped installer (no TTY)', /curl[^\n|]*\|\s*(sudo\s+)?bash/, /\bnever use\b/i],
    [
      'lowercase payout chain code',
      /blockchainCode["']?\s*[:=]\s*["'](ethereum|bitcoin|tron|base|polygon)["']/,
    ],
    ['non-existent dashboard webhook secret', /copy (the )?(shared )?webhook secret/i],
    ['claims there is no webhook HMAC', /no HMAC|not an? X-Pay[Rr]am-Signature/],
    ['TON support', /\bTON\b/],
    ['x402 support claim', /x402/i],
    [
      'PayRam fee or price claim',
      /\b0\s?%|zero fees?|no (transaction |processing )?fees?\b|free of charge|keep 100%/i,
    ],
    ['hosted api.payram.com default', /api\.payram\.com/],
    ['non-existent agent CLI commands', /setup-eth|setup-base|PAYRAM_BLOCKCHAIN_SETUP/],
    ['routine reset with -y', /reset-local\s+-y/],
    ['analytics fee fields', /payramFees|feePercentage/],
  ])('has no %s', (_label, pattern, allow) => {
    const offending = text.split('\n').filter((line) => pattern.test(line) && !allow?.test(line));
    expect(offending).toEqual([]);
  });

  it('only mentions legacy ports as things to avoid', () => {
    for (const line of text.split('\n').filter((l) => /:8080|:8443|\b5432\b/.test(l))) {
      expect(line, line).toMatch(
        /not|never|legacy|no :8080|block|avoid|drop|DROP|may still|bypass|8080 8443/i,
      );
    }
  });
});

describe('payram_setup_plan', () => {
  it('defaults to a headless testnet install with the human hand-offs', () => {
    const plan = buildSetupPlan({});
    const text = renderSetupPlan(plan);
    expect(plan.inputs).toMatchObject({ network: 'testnet', path: 'agent', ssl: 'none' });
    expect(text).toContain('setup_payram_agents.sh) --testnet');
    expect(text).toContain('Settings → Site URL');
    expect(text).toMatch(/first person to sign up becomes root/i);
    expect(plan.phases.map((p) => p.id)).toEqual([
      'prepare',
      'install',
      'account',
      'wallet',
      'first_payment',
      'harden',
    ]);
  });

  it('gates mainnet spend and the cold wallet', () => {
    const plan = buildSetupPlan({ network: 'mainnet', domain: 'pay.example.com' });
    const install = plan.phases.find((p) => p.id === 'install')!.steps[0];
    expect(install.commands).toContain('PAYRAM_FUND_COLLECTOR');
    expect(install.commands).toContain('--mainnet');
    expect(install.gate).toBeTruthy();
    expect(plan.phases.find((p) => p.id === 'harden')!.steps.map((s) => s.id)).toContain(
      'ssl_renewal',
    );
  });

  it('adds the operator phase and resumes from a stage', () => {
    expect(buildSetupPlan({ role: 'operator' }).phases.map((p) => p.id)).toContain('operator');
    const resumed = buildSetupPlan({ stage: 'wallet_ready', integration: 'shopify' });
    expect(resumed.phases.map((p) => p.id)).toEqual(['first_payment', 'harden', 'integrate']);
  });

  it('warns when Let’s Encrypt is chosen without a domain', () => {
    expect(buildSetupPlan({ ssl: 'letsencrypt' }).warnings.join(' ')).toMatch(/needs a domain/);
  });
});

describe('payram_ops_playbook', () => {
  it.each(OPS_TASKS)('recipe %s is complete', (task) => {
    const recipe = getRecipe(task);
    expect(recipe.task).toBe(task);
    expect(recipe.commands.length).toBeGreaterThan(20);
    expect(recipe.interpret.length).toBeGreaterThan(0);
    if (recipe.safety !== 'read') expect(recipe.title).toMatch(/confirm/i);
    if (recipe.auth === 'jwt') expect(recipe.commands).toContain('Authorization: Bearer');
    if (recipe.auth === 'api_key') expect(recipe.commands).toContain('API-Key');
  });

  it('never sends both credentials in one request', () => {
    for (const task of OPS_TASKS) {
      for (const line of getRecipe(task).commands.split('\n')) {
        expect(
          line.includes('Authorization: Bearer') && line.includes('API-Key:'),
          `${task}: ${line}`,
        ).toBe(false);
      }
    }
  });

  it('teaches a recipe for every credentialed data tool', () => {
    for (const tool of Object.keys(PLAYBOOK_FOR_TOOL)) {
      const text = teachDirectApi(tool);
      expect(text, tool).toMatch(/not set/);
      expect(text, tool).toContain(getRecipe(PLAYBOOK_FOR_TOOL[tool]).title);
    }
    expect(teachDirectApi('generate_env_template')).toBeUndefined();
  });
});

describe('payram_runbook', () => {
  it.each(RUNBOOK_TASKS)('runbook %s has steps and a way to verify', (task) => {
    const rb = getRunbook(task);
    expect(rb.steps.length).toBeGreaterThan(0);
    expect(rb.verify.length).toBeGreaterThan(0);
    expect(renderRunbook(rb)).toContain(rb.title);
  });

  it('marks destructive and money-moving steps with a stop', () => {
    for (const task of [
      'reset_test_install',
      'restore',
      'add_chain',
      'smart_bridge',
      'mainnet_cutover',
    ] as const) {
      expect(
        getRunbook(task).steps.some((s) => s.gate),
        task,
      ).toBe(true);
    }
  });
});
