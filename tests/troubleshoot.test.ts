import { describe, expect, it } from 'vitest';
import { ISSUES } from '../src/troubleshooting/issues.js';
import { findIssues } from '../src/troubleshooting/match.js';
import { renderTroubleshoot, runTroubleshoot } from '../src/tools/troubleshoot.js';
import { OPS_TASKS } from '../src/tools/guides/opsPlaybook.js';
import { RUNBOOK_TASKS } from '../src/tools/guides/runbooks.js';
import { textOf, withClient, type Era } from './helpers.js';

const topId = (symptom: string) => findIssues({ symptom })[0]?.issue.id;

describe('troubleshooting bank', () => {
  it('has unique ids and complete entries', () => {
    expect(new Set(ISSUES.map((i) => i.id)).size).toBe(ISSUES.length);
    for (const i of ISSUES) {
      expect(i.signs.length, i.id).toBeGreaterThan(0);
      expect(i.fix.length, i.id).toBeGreaterThan(0);
      for (const s of i.signs) expect(s, `${i.id}: signs are lowercase`).toBe(s.toLowerCase());
    }
  });

  it('only points at tools and tasks that exist', () => {
    for (const issue of ISSUES) {
      for (const see of issue.see ?? []) {
        if (see.tool === 'payram_runbook') {
          expect(RUNBOOK_TASKS, issue.id).toContain(see.task);
        } else if (see.tool === 'payram_ops_playbook') {
          expect(OPS_TASKS, issue.id).toContain(see.task);
        }
      }
    }
  });

  it('finds every entry from its own wording', () => {
    for (const issue of ISSUES) {
      const ids = findIssues({ symptom: issue.signs.join(' ') }).map((m) => m.issue.id);
      expect(ids, issue.id).toContain(issue.id);
    }
  });

  it.each([
    ['/bin/bash: line 11: declare: -g: invalid option', 'installer-script-error'],
    [
      '{"code":5,"message":"Error occurred while creating the payment request."}',
      'payment-create-code-5',
    ],
    ['the payment link opens http://localhost and customers cannot pay', 'links-show-localhost'],
    ['Error 522 Connection timed out cloudflare', 'cloudflare-or-proxy-errors'],
    ['ETH sweep stays loading forever and funds are not swept', 'sweep-not-happening'],
    ['payment stays OPEN, depositAddress null, currencySymbol null', 'payment-open-no-address'],
    ['unable to load wallet in the PayRam Business app', 'mobile-app-wallet-load'],
    ['listen tcp 0.0.0.0:80: bind: address already in use', 'port-in-use'],
    ['my handler logs invalid-webhook-signature for every event', 'webhook-signature-mismatch'],
    ['502 Bad Gateway nginx after upgrade', 'gateway-5xx'],
    ['customer paid but not credited, transaction not showing', 'deposit-not-credited'],
  ])('"%s" points at %s', (text, expected) => {
    expect(topId(text)).toBe(expected);
  });

  it('does not match on short numbers inside longer ones', () => {
    expect(findIssues({ symptom: 'block 14013 processed' })).toEqual([]);
  });
});

describe('runTroubleshoot', () => {
  it('lists the known problems when asked about nothing', () => {
    const out = runTroubleshoot({});
    expect(out.matches).toEqual([]);
    expect(out.index?.length).toBe(ISSUES.length);
  });

  it('asks for read-only evidence when nothing matches', () => {
    const out = runTroubleshoot({ symptom: 'purple elephants everywhere' });
    expect(out.matches).toEqual([]);
    expect(out.gather?.join('\n')).toContain('supervisorctl');
  });

  it('looks one entry up by id, and falls back to the index for an unknown id', () => {
    expect(runTroubleshoot({ id: 'port-in-use' }).matches[0]?.id).toBe('port-in-use');
    expect(runTroubleshoot({ id: 'nope' }).index?.length).toBe(ISSUES.length);
  });

  it('warns about pasted secrets without repeating them', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop';
    const out = runTroubleshoot({ output: `Authorization: Bearer ${token} 401 unauthorized` });
    expect(out.warning).toBeDefined();
    expect(JSON.stringify(out)).not.toContain(token);
    expect(renderTroubleshoot(out)).not.toContain(token);
  });

  it('never echoes what was pasted', () => {
    const marker = 'zzmarker-unique-9931';
    const text = renderTroubleshoot(runTroubleshoot({ output: `${marker} 502 bad gateway` }));
    expect(text).not.toContain(marker);
  });
});

describe.each<Era>(['modern', 'legacy'])('payram_troubleshoot over the %s protocol era', (era) => {
  it('answers a symptom with a fix', () =>
    withClient(era, async (client) => {
      const result = await client.callTool({
        name: 'payram_troubleshoot',
        arguments: { symptom: 'payment link opens localhost' },
      });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('Site URL');
    }));
});
