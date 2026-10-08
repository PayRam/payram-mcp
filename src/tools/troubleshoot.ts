import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { safeHandler } from './common/errors.js';
import { textContent } from './common/content.js';
import { AREAS, ISSUES, ISSUE_BY_ID, type Issue } from '../troubleshooting/issues.js';
import { MAX_INPUT_CHARS, findIssues, looksLikeSecret } from '../troubleshooting/match.js';
import { CONTAINER, LINKS } from '../facts/payram.js';

/**
 * payram_troubleshoot — "what does this mean and what do I do next?"
 *
 * Takes a symptom in plain words and/or pasted error or log text, and returns
 * the known problems it matches with how to confirm and fix each. Works on the
 * hosted server: it needs no credentials and no access to anyone's server, and
 * it never stores or logs what is pasted.
 */

const inputSchema = z.object({
  symptom: z
    .string()
    .max(2_000)
    .optional()
    .describe(
      'The problem in plain words, e.g. "payment link opens localhost" or "502 after upgrade".',
    ),
  output: z
    .string()
    .max(MAX_INPUT_CHARS)
    .optional()
    .describe(
      'Error text or log lines to match. Remove API keys, tokens, passwords and seed phrases first.',
    ),
  area: z.enum(AREAS).optional().describe('Narrow the search to one area.'),
  id: z
    .string()
    .max(80)
    .optional()
    .describe('Show one known problem by its id (from an earlier answer).'),
});

type Input = z.infer<typeof inputSchema>;

const issueSchema = z.object({
  id: z.string(),
  area: z.string(),
  title: z.string(),
  confidence: z.enum(['likely', 'possible', 'listed']),
  meaning: z.string(),
  confirm: z.array(z.string()),
  fix: z.array(z.string()),
  needsHuman: z.string().optional(),
  nextTools: z.array(z.string()),
  paste: z.string().optional(),
});

const outputSchema = z.object({
  matches: z.array(issueSchema),
  index: z.array(z.object({ id: z.string(), area: z.string(), title: z.string() })).optional(),
  gather: z.array(z.string()).optional(),
  warning: z.string().optional(),
});

type Output = z.infer<typeof outputSchema>;
type Entry = Output['matches'][number];

const callText = (see: NonNullable<Issue['see']>[number]): string =>
  see.task ? `${see.tool} {"task":"${see.task}"}` : see.tool;

const toEntry = (issue: Issue, confidence: Entry['confidence']): Entry => ({
  id: issue.id,
  area: issue.area,
  title: issue.title,
  confidence,
  meaning: issue.meaning,
  confirm: [...issue.confirm],
  fix: [...issue.fix],
  needsHuman: issue.needsHuman,
  nextTools: (issue.see ?? []).map(callText),
  paste: issue.paste,
});

/** What to collect when nothing matches. Read-only commands, no secrets. */
export const GATHER_COMMANDS = [
  `docker ps --filter name=${CONTAINER.name}`,
  CONTAINER.supervisorctl,
  'curl -s http://localhost/api/v1/health',
  'tail -n 40 ~/.payram-core/log/payram.log',
];

const SECRET_WARNING =
  'What you pasted looks like it may contain a key, token or seed phrase. It was not stored or repeated, but treat it as exposed: rotate that API key or password, and never paste a seed phrase anywhere.';

export const runTroubleshoot = (input: Input): Output => {
  const warning = looksLikeSecret(`${input.symptom ?? ''}\n${input.output ?? ''}`)
    ? SECRET_WARNING
    : undefined;

  if (input.id) {
    const issue = ISSUE_BY_ID.get(input.id);
    return issue
      ? { matches: [toEntry(issue, 'listed')], warning }
      : { matches: [], index: indexOf(), warning };
  }

  const found = findIssues(input);
  if (found.length) {
    return { matches: found.map((m) => toEntry(m.issue, m.confidence)), warning };
  }
  const described = Boolean((input.symptom ?? '').trim() || (input.output ?? '').trim());
  return {
    matches: [],
    // Nothing described: show the whole index. Described but unmatched: say what to collect.
    ...(described ? { gather: GATHER_COMMANDS } : { index: indexOf(input.area) }),
    warning,
  };
};

const indexOf = (area?: Input['area']) =>
  ISSUES.filter((i) => !area || i.area === area).map((i) => ({
    id: i.id,
    area: i.area,
    title: i.title,
  }));

const renderEntry = (e: Entry, n: number): string[] => {
  const label = e.confidence === 'listed' ? '' : ` (${e.confidence} match)`;
  const lines = [
    `## ${n}. ${e.title}${label}`,
    `id: ${e.id}`,
    '',
    `What it usually means: ${e.meaning}`,
  ];
  if (e.confirm.length) lines.push('', 'Check:', ...e.confirm.map((c) => `- ${c}`));
  lines.push('', 'Fix:', ...e.fix.map((f) => `- ${f}`));
  if (e.needsHuman) lines.push('', `Needs the human: ${e.needsHuman}`);
  if (e.nextTools.length) lines.push('', 'More help:', ...e.nextTools.map((t) => `- ${t}`));
  if (e.paste) lines.push('', `If it is still not fixed, paste: ${e.paste}`);
  return lines;
};

export const renderTroubleshoot = (out: Output): string => {
  const lines = ['# PayRam troubleshooting', ''];
  if (out.warning) lines.push(`⚠ ${out.warning}`, '');
  if (out.matches.length) {
    out.matches.forEach((m, i) => lines.push(...renderEntry(m, i + 1), ''));
    lines.push('If none of these fit, call this tool again with more of the error text.');
  } else if (out.gather) {
    lines.push(
      'No known problem matches that yet. To find out more, run these read-only commands on the PayRam server and paste the output (remove any keys, tokens or passwords first):',
      '',
      '```bash',
      ...out.gather,
      '```',
      '',
      'Or call payram_doctor with the server’s public URL for a check that needs no access.',
      `Known problem areas (call again with \`area\` to list them): ${AREAS.join(', ')}.`,
      `Still stuck? The PayRam team and community: ${LINKS.community}`,
    );
  } else if (out.index) {
    lines.push(
      'Known problems (call again with `id`, or describe yours in `symptom` / paste the error in `output`):',
      '',
    );
    let area = '';
    for (const i of out.index) {
      if (i.area !== area) lines.push(`**${i.area}**`);
      area = i.area;
      lines.push(`- ${i.id}: ${i.title}`);
    }
  }
  return lines.join('\n');
};

export const registerTroubleshootTool = (server: McpServer) => {
  server.registerTool(
    'payram_troubleshoot',
    {
      title: 'Troubleshoot a PayRam problem',
      description:
        'Something is not working? Describe the problem in plain words and/or paste the error or log text. Returns the known PayRam problems it matches, what each usually means, how to confirm it and the fix, plus which tool to use next. Needs no credentials and no access to the server; what you paste is not stored. Call with nothing to list known problems. For a live check of a running server use payram_doctor.',
      inputSchema,
      outputSchema,
    },
    safeHandler(
      async (args: Input) => {
        const result = runTroubleshoot(args);
        return { content: [textContent(renderTroubleshoot(result))], structuredContent: result };
      },
      { toolName: 'payram_troubleshoot' },
    ),
  );
};
