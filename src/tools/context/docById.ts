import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildToolSchemas } from '../common/schemas.js';
import { safeHandler } from '../common/errors.js';
import { getDocsRoot, loadMarkdown } from '../../utils/markdownLoader.js';

const lookupSchemas = buildToolSchemas({
  input: z.object({
    id: z.string().min(1, 'Provide a document id, e.g. "features/payouts".'),
  }),
  output: z.object({
    id: z.string(),
    path: z.string(),
    url: z.string().url().optional(),
    markdown: z.string(),
  }),
});

const textContent = (text: string) => ({ type: 'text' as const, text });

const listSchemas = buildToolSchemas({
  input: z.object({
    prefix: z.string().optional(),
  }),
  output: z.object({
    prefix: z.string().optional(),
    count: z.number(),
    docs: z.array(z.string()),
  }),
});

const describeMissingDoc = async (relativePath: string): Promise<string> => {
  const docsRoot = getDocsRoot();
  const fullPath = path.join(docsRoot, relativePath);
  const parentDir = path.dirname(fullPath);
  const section = path.relative(docsRoot, parentDir) || 'root';

  try {
    const siblings = (await fs.readdir(parentDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => {
        const siblingRelative = path.posix.join(
          section === 'root' ? '' : section.replace(/\\/g, '/'),
          entry.name.replace(/\.md$/, ''),
        );
        return siblingRelative || entry.name;
      });

    if (siblings.length) {
      const prettySection = section === 'root' ? 'the root docs folder' : `docs/${section}`;
      return `No doc found for "${relativePath}". Available entries in ${prettySection}: ${siblings.join(', ')}.`;
    }
  } catch {
    // Ignore directory listing errors; we'll fall back to the generic message below.
  }

  return `No doc found for "${relativePath}". Call list_payram_docs to see the available ids.`;
};

const buildDocMetadata = (id: string) => {
  if (id.includes('..')) {
    throw new Error('Doc id must not include path traversal characters.');
  }

  const normalized = id.replace(/^\/+|\/+$/g, '');
  const pathWithExt = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  const cleanedPath = pathWithExt.replace(/\\+/g, '/');

  return {
    id: normalized,
    path: cleanedPath,
    url: `https://docs.payram.com/${normalized}`,
  } as const;
};

const sanitizePrefix = (prefix?: string) => {
  if (!prefix) {
    return '';
  }
  if (prefix.includes('..')) {
    throw new Error('Prefix must not include path traversal characters.');
  }
  const normalized = prefix.replace(/^\/+/g, '').replace(/\/+/g, '/');
  return normalized.replace(/\/+$/g, '');
};

const joinRelativePath = (base: string, segment: string) => (base ? `${base}/${segment}` : segment);

const collectDocIds = async (relativeDir: string): Promise<string[]> => {
  const docsRoot = getDocsRoot();
  const absoluteDir = path.join(docsRoot, relativeDir);
  const exists = await fs
    .access(absoluteDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(
      `Unknown docs prefix "${relativeDir}". Call list_payram_docs to see the available folders.`,
    );
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const docs: string[] = [];
  const subdirectories: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      subdirectories.push(entry.name);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/, '');
      const rel = joinRelativePath(relativeDir, base);
      docs.push(rel);
    }
  }

  for (const dir of subdirectories) {
    const relDir = joinRelativePath(relativeDir, dir);
    const nestedDocs = await collectDocIds(relDir);
    docs.push(...nestedDocs);
  }

  docs.sort((a, b) => a.localeCompare(b));
  return docs;
};

/**
 * The mirrored docs come from a hosted-docs export and carry its page chrome
 * (copy buttons, anchor links, image proxies, breadcrumbs). Strip that so an
 * agent reads the content, not the markup debris.
 */
export const cleanDocMarkdown = (markdown: string): string =>
  markdown
    .split('\n')
    .filter(
      (line) =>
        !/^\s*copyCopy\S*\s*$/.test(line) &&
        !/^\s*\[hashtag\]\(#[^)]*\)\s*$/.test(line) &&
        !/^\s*!\[[^\]]*\]\(https:\/\/docs\.payram\.com\/~gitbook\/[^)]*\)\s*$/.test(line) &&
        !/^#{1,6}\s*$/.test(line),
    )
    .join('\n')
    .replace(/\s*(?:arrow-up-right|chevron-right|chevron-down)\b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const registerDocLookupTool = (server: McpServer) => {
  server.registerTool(
    'get_payram_doc_by_id',
    {
      title: 'Get Payram Doc By ID',
      description: 'Returns the markdown for a Payram doc given its id, e.g. "features/payouts".',
      inputSchema: lookupSchemas.input,
      outputSchema: lookupSchemas.output,
    },
    safeHandler(
      async ({ id }) => {
        const metadata = buildDocMetadata(id);
        let markdown: string;
        try {
          markdown = await loadMarkdown(metadata.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(await describeMissingDoc(metadata.path));
          }
          throw error;
        }

        return {
          content: [textContent(`Loaded doc ${metadata.id} (${metadata.path})`)],
          structuredContent: {
            ...metadata,
            markdown: cleanDocMarkdown(markdown),
          },
        };
      },
      { toolName: 'get_payram_doc_by_id' },
    ),
  );

  server.registerTool(
    'list_payram_docs',
    {
      title: 'List Payram Docs',
      description:
        'Lists the available Payram doc ids. Optionally scope by a prefix such as "features".',
      inputSchema: listSchemas.input,
      outputSchema: listSchemas.output,
    },
    safeHandler(
      async ({ prefix }) => {
        const sanitizedPrefix = sanitizePrefix(prefix);
        const docs = await collectDocIds(sanitizedPrefix);

        return {
          content: [
            textContent(
              `Found ${docs.length} doc${docs.length === 1 ? '' : 's'} under ${sanitizedPrefix || 'root'}.`,
            ),
          ],
          structuredContent: {
            prefix: sanitizedPrefix || undefined,
            count: docs.length,
            docs,
          },
        } satisfies {
          content: ReturnType<typeof textContent>[];
          structuredContent: z.infer<typeof listSchemas.output>;
        };
      },
      { toolName: 'list_payram_docs' },
    ),
  );
};
