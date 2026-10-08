/**
 * Make tool results readable by clients that only forward `content` to the
 * model. Several tools return their payload in `structuredContent` with a
 * one-line status as text; the MCP spec asks servers to also provide the
 * payload as text for those clients. This renders it as markdown.
 */

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

const fence = (code: string, lang = ''): string => {
  const ticks = code.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${code.replace(/\n+$/, '')}\n${ticks}`;
};

const renderTree = (node: unknown, depth = 0): string[] => {
  if (!isRecord(node)) return [];
  const path = str(node.path) ?? '';
  const note = str(node.description);
  const line = `${'  '.repeat(depth)}- ${path}${node.type === 'folder' && !path.endsWith('/') ? '/' : ''}${note ? ` - ${note}` : ''}`;
  const kids = Array.isArray(node.children)
    ? node.children.flatMap((c) => renderTree(c, depth + 1))
    : [];
  return [line, ...kids];
};

const renderSections = (sections: unknown[]): string[] =>
  sections.filter(isRecord).flatMap((s) => {
    const body = str(s.markdown);
    return body ? [`### ${str(s.title) ?? str(s.id) ?? ''}`.trim(), body] : [];
  });

/** Markdown for a structured result, or '' when there is nothing renderable. */
export const renderStructured = (sc: Json): string => {
  const out: string[] = [];
  const title = str(sc.title);
  if (title) out.push(`## ${title}`);
  const description = str(sc.description);
  if (description) out.push(description);

  const lang = str(sc.language) ?? (isRecord(sc.meta) ? str(sc.meta.language) : undefined) ?? '';
  const snippet = str(sc.snippet);
  if (snippet) out.push(fence(snippet, lang));
  const envExample = str(sc.envExample);
  if (envExample) out.push(fence(envExample, 'dotenv'));
  const markdown = str(sc.markdown);
  if (markdown) out.push(markdown);
  const instructions = str(sc.instructions);
  if (instructions) out.push(instructions);

  if (Array.isArray(sc.variables)) {
    out.push(
      '### Variables',
      ...sc.variables
        .filter(isRecord)
        .map(
          (v) =>
            `- \`${str(v.key)}\`${v.required ? ' (required)' : ''}: ${str(v.description) ?? ''}${str(v.example) ? ` e.g. \`${str(v.example)}\`` : ''}`,
        ),
    );
  }
  if (Array.isArray(sc.items)) {
    out.push(
      ...sc.items
        .filter(isRecord)
        .map((i, n) => `${n + 1}. **${str(i.label) ?? ''}**: ${str(i.description) ?? ''}`),
    );
  }
  if (Array.isArray(sc.sections)) out.push(...renderSections(sc.sections));
  if (isRecord(sc.root)) out.push('### Layout', renderTree(sc.root).join('\n'));
  if (Array.isArray(sc.files)) {
    for (const f of sc.files.filter(isRecord)) {
      const note = str(f.description);
      out.push(
        `### ${str(f.path) ?? 'file'}${note ? `\n${note}` : ''}`,
        fence(str(f.contents) ?? ''),
      );
    }
  }
  if (Array.isArray(sc.docs)) {
    out.push(`### Docs (${sc.docs.length})`, sc.docs.map((d) => `- ${String(d)}`).join('\n'));
  }
  const notes = str(sc.notes);
  if (notes) out.push(`Notes: ${notes}`);
  return out.join('\n\n');
};

interface ToolResultLike {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
}

/**
 * Append the rendered payload when the text a model would read is much
 * smaller than the structured result. Tools that already render their own
 * text (plans, doctor, runbooks) are left alone.
 */
export const withReadableText = <R extends ToolResultLike>(result: R): R => {
  const sc = result?.structuredContent;
  if (!isRecord(sc)) return result;
  const text = (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  if (text.length >= 0.25 * JSON.stringify(sc).length) return result;
  const rendered = renderStructured(sc);
  if (!rendered) return result;
  return {
    ...result,
    content: [...(result.content ?? []), { type: 'text' as const, text: rendered }],
  };
};
