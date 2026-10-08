import { describe, expect, it } from 'vitest';
import { cleanDocMarkdown } from '../src/tools/context/docById.js';
import { apiErrorMessage } from '../src/utils/httpHints.js';
import { REQUIREMENTS } from '../src/facts/payram.js';
import { textOf, withClient } from './helpers.js';

// What a caller sees must help them navigate, not describe this repo's internals.
const INTERNAL =
  /docs\/(js-sdk|payram-)|payram-external\.yaml|payram-webhook\.yaml|merchant-payouts-api|payram-docs-live|\/var\/task|node_modules/;

const SKIP_CALL = ['payram_doctor', 'test_payram_connection'];

describe('public surface', () => {
  it('shows no repository paths in tool descriptions or tool output', () =>
    withClient('modern', async (client) => {
      const { tools } = await client.listTools();
      const offenders: string[] = [];
      for (const tool of tools) {
        if (INTERNAL.test(tool.description ?? '')) offenders.push(`${tool.name} (description)`);
        if (SKIP_CALL.includes(tool.name)) continue;
        const schema = tool.inputSchema as {
          required?: string[];
          properties?: Record<string, { enum?: unknown[] }>;
        };
        const args = Object.fromEntries(
          (schema.required ?? []).map((k) => [
            k,
            schema.properties?.[k]?.enum?.[0] ?? 'features/payouts',
          ]),
        );
        const result = await client.callTool({ name: tool.name, arguments: args });
        const all = `${textOf(result)} ${JSON.stringify(result.structuredContent ?? '')}`;
        if (INTERNAL.test(all)) offenders.push(`${tool.name} (output)`);
      }
      expect(offenders).toEqual([]);
    }));

  it('lists superseded tools last and says what replaced them', () =>
    withClient('modern', async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      const deprecated = tools.filter((t) => /deprecated/i.test(t.description ?? ''));
      expect(deprecated.map((t) => t.name).sort()).toEqual(
        ['onboard_agent_setup', 'test_payram_connection'].sort(),
      );
      for (const t of deprecated) {
        expect(names.indexOf(t.name)).toBeGreaterThanOrEqual(names.length - deprecated.length);
        expect(t.description).toMatch(/use payram_/);
      }
    }));

  it('gives one set of server requirements everywhere', () =>
    withClient('modern', async (client) => {
      const result = await client.callTool({ name: 'prepare_payram_test', arguments: {} });
      const text = textOf(result);
      expect(text).toContain(REQUIREMENTS.server);
      expect(text).not.toMatch(/6 GB|15 GB\+/);
      expect(text).not.toMatch(/test payram/);
    }));
});

describe('cleanDocMarkdown', () => {
  it('removes page chrome but keeps the content', () => {
    const raw = [
      'copyCopychevron-down',
      '',
      '1.  [FEATURES](/features)chevron-right',
      '',
      '![](https://docs.payram.com/~gitbook/image?url=x&width=768)',
      '',
      '## ',
      '',
      '[hashtag](#why-it-matters)',
      '',
      '**Why it matters**',
      '',
      'See [docs](https://example.com arrow-up-right)',
    ].join('\n');
    const clean = cleanDocMarkdown(raw);
    expect(clean).toContain('**Why it matters**');
    expect(clean).toContain('[FEATURES](/features)');
    expect(clean).not.toMatch(/copyCopy|gitbook|hashtag|chevron|arrow-up-right/);
    expect(clean).not.toMatch(/\n{3,}/);
  });

  it('serves a real doc without the debris', () =>
    withClient('modern', async (client) => {
      const result = await client.callTool({
        name: 'get_payram_doc_by_id',
        arguments: { id: 'features/payouts' },
      });
      const md = (result.structuredContent as { markdown: string }).markdown;
      expect(md.length).toBeGreaterThan(200);
      expect(md).not.toMatch(/copyCopy|gitbook\/image|\[hashtag\]/);
    }));
});

describe('apiErrorMessage', () => {
  it('explains payment-creation code 5 whatever the HTTP status', () => {
    const body = '{"code":5,"message":"Error occurred while creating the payment request."}';
    for (const status of [200, 500]) {
      expect(apiErrorMessage('Create payment link', status, body)).toMatch(/deposit wallet/);
    }
  });
});
