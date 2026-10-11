import { describe, expect, it } from 'vitest';
import { renderStructured, withReadableText } from '../src/mcp/resultText.js';
import { textOf, withClient, type Era } from './helpers.js';

// Network-touching tools are covered by their own tests; the project assessment writes its own summary.
const SKIP = ['payram_doctor', 'test_payram_connection', 'assess_payram_project'];

describe('renderStructured', () => {
  it('renders snippets, files and docs as markdown', () => {
    expect(renderStructured({ title: 'T', snippet: 'const a = 1;', language: 'ts' })).toContain(
      '```ts\nconst a = 1;\n```',
    );
    const files = renderStructured({ files: [{ path: 'a.js', description: 'd', contents: 'x' }] });
    expect(files).toContain('### a.js');
    expect(files).toContain('```\nx\n```');
    expect(renderStructured({ docs: ['a/b'] })).toContain('- a/b');
  });

  it('uses a longer fence when the code contains one', () => {
    expect(renderStructured({ snippet: 'a\n```\nb' })).toContain('````');
  });
});

describe('withReadableText', () => {
  it('leaves results that already carry their text alone', () => {
    const result = {
      content: [{ type: 'text', text: 'x'.repeat(100) }],
      structuredContent: { a: 'y'.repeat(100) },
    };
    expect(withReadableText(result)).toBe(result);
  });

  it('adds the payload when only a status line is present', () => {
    const result = withReadableText({
      content: [{ type: 'text', text: 'Generated.' }],
      structuredContent: { snippet: 'return 42;'.repeat(20) },
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[1]?.text).toContain('return 42;');
  });
});

describe.each<Era>(['modern', 'legacy'])(
  'every tool is readable without structuredContent (%s)',
  (era) => {
    it('returns the payload as text', () =>
      withClient(era, async (client) => {
        const { tools } = await client.listTools();
        const empty: string[] = [];
        for (const tool of tools) {
          if (SKIP.includes(tool.name)) continue;
          const schema = tool.inputSchema as {
            required?: string[];
            properties?: Record<string, { enum?: unknown[] }>;
          };
          const args = Object.fromEntries(
            (schema.required ?? []).map((k) => [k, schema.properties?.[k]?.enum?.[0] ?? 'x']),
          );
          const result = await client.callTool({ name: tool.name, arguments: args });
          const sc = result.structuredContent;
          if (!sc || result.isError) continue;
          if (textOf(result).length < 0.25 * JSON.stringify(sc).length) empty.push(tool.name);
        }
        expect(empty).toEqual([]);
      }));
  },
);
