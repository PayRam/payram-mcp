import { describe, expect, it, vi } from 'vitest';
import { PLAYBOOK_FOR_TOOL } from '../src/tools/guides/opsPlaybook.js';
import { textOf, withClient, type Era } from './helpers.js';

const GUIDE_TOOLS = [
  'payram_setup_plan',
  'payram_doctor',
  'payram_troubleshoot',
  'payram_runbook',
  'payram_ops_playbook',
];
const WRITE_TOOLS = ['create_payment_link', 'restart_payram_worker'];
const LOCAL_ONLY = [
  'assess_payram_project',
  'list_platforms',
  'get_payment_summary',
  'lookup_payment',
  'search_payments',
  'get_unswept_balances',
  'get_daily_volume',
  'list_currencies',
  'list_recipients',
  'create_payment_link',
  'check_node_sync',
  'restart_payram_worker',
  'check_payment_readiness',
];

const toolNames = (era: Era) =>
  withClient(era, async (client) => (await client.listTools()).tools.map((t) => t.name));

describe.each<Era>(['modern', 'legacy'])('tool catalog over the %s protocol era', (era) => {
  it('lists start-here tools first, with valid names and full annotations', () =>
    withClient(era, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.slice(0, GUIDE_TOOLS.length).map((t) => t.name)).toEqual(GUIDE_TOOLS);
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      for (const tool of tools) {
        expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
        const a = tool.annotations ?? {};
        for (const hint of [
          'readOnlyHint',
          'destructiveHint',
          'idempotentHint',
          'openWorldHint',
        ] as const) {
          expect(typeof a[hint], `${tool.name}.${hint}`).toBe('boolean');
        }
        if (WRITE_TOOLS.includes(tool.name)) {
          expect(a.readOnlyHint).toBe(false);
          expect(a.destructiveHint).toBe(true);
        } else {
          expect(a.readOnlyHint, tool.name).toBe(true);
        }
      }
    }));

  it('serves the onboarding guides without touching the filesystem', () =>
    withClient(era, async (client) => {
      for (const name of ['onboard_agent_setup', 'get_agent_setup_flow']) {
        const result = await client.callTool({ name, arguments: {} });
        expect(result.isError, name).toBeFalsy();
        expect(textOf(result).length).toBeGreaterThan(500);
      }
    }));

  it('exposes playbook and runbook resource templates', () =>
    withClient(era, async (client) => {
      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
        'payram://ops/playbook/{task}',
        'payram://runbooks/{task}',
      ]);
      const read = await client.readResource({ uri: 'payram://ops/playbook/daily_check' });
      expect(JSON.stringify(read.contents)).toContain('sweeps/metrics');
    }));
});

describe('hosted catalog', () => {
  it('omits tools that need this server’s credentials or filesystem, and stays small', () => {
    vi.stubEnv('PAYRAM_MCP_MODE', 'hosted');
    return withClient('legacy', async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of LOCAL_ONLY) expect(names).not.toContain(name);
      expect(JSON.stringify(tools).length).toBeLessThan(60_000);
    });
  });

  it('every local-only credentialed tool has a direct-API recipe to fall back on', async () => {
    vi.stubEnv('PAYRAM_MCP_MODE', 'hosted');
    const hosted = new Set(await toolNames('legacy'));
    vi.stubEnv('PAYRAM_MCP_MODE', 'local');
    const localOnly = (await toolNames('legacy')).filter((n) => !hosted.has(n));
    expect(localOnly.sort()).toEqual([...LOCAL_ONLY].sort());
    // assess_payram_project reads the caller's repo, not PayRam, so it has no API recipe.
    for (const name of localOnly.filter((n) => n !== 'assess_payram_project')) {
      expect(PLAYBOOK_FOR_TOOL, name).toHaveProperty(name);
    }
  });

  it('local mode teaches the direct-API recipe when credentials are missing', () => {
    vi.stubEnv('PAYRAM_MCP_MODE', 'local');
    vi.stubEnv('PAYRAM_BASE_URL', undefined);
    vi.stubEnv('PAYRAM_ACCESS_TOKEN', undefined);
    return withClient('legacy', async (client) => {
      const result = await client.callTool({ name: 'check_node_sync', arguments: {} });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('/api/v1/blockchains');
      expect(text).toContain('Authorization: Bearer');
    });
  });
});
