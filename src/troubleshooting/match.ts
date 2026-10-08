import { ISSUES, type Area, type Issue } from './issues.js';

/** Longest text we look at; the rest of a pasted log is ignored. */
export const MAX_INPUT_CHARS = 20_000;

export interface Match {
  issue: Issue;
  score: number;
  confidence: 'likely' | 'possible';
}

const ANSI = /\u001b\[[0-9;]*m/g;

const normalize = (text: string): string =>
  text.slice(0, MAX_INPUT_CHARS).replace(ANSI, '').toLowerCase().replace(/\s+/g, ' ');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Short fragments must match as whole words so "401" does not hit "14013". */
const containsSign = (text: string, sign: string): boolean =>
  sign.length <= 6
    ? new RegExp(`(?<![a-z0-9])${escapeRegExp(sign)}(?![a-z0-9])`).test(text)
    : text.includes(sign);

const signWeight = (sign: string): number => (sign.length >= 12 ? 4 : sign.length >= 7 ? 3 : 1.5);

const titleWords = (issue: Issue): string[] => [
  ...new Set(issue.title.toLowerCase().match(/[a-z]{5,}/g) ?? []),
];

export const scoreIssue = (issue: Issue, text: string): number => {
  let score = 0;
  for (const pattern of issue.patterns ?? []) if (pattern.test(text)) score += 6;
  for (const sign of issue.signs) if (containsSign(text, sign)) score += signWeight(sign);
  const overlap = titleWords(issue).filter((w) => text.includes(w)).length;
  return score + Math.min(overlap * 0.5, 2);
};

const MIN_SCORE = 3;
const STRONG_SCORE = 6;
const MAX_RESULTS = 3;

/** Best matching known problems for what the user described or pasted. */
export const findIssues = (input: { symptom?: string; output?: string; area?: Area }): Match[] => {
  const text = normalize(`${input.symptom ?? ''} ${input.output ?? ''}`);
  if (!text.trim()) return [];
  const scored = ISSUES.filter((i) => !input.area || i.area === input.area)
    .map((issue) => ({ issue, score: scoreIssue(issue, text) }))
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored
    .filter((m) => m.score >= top * 0.5)
    .slice(0, MAX_RESULTS)
    .map((m) => ({ ...m, confidence: m.score >= STRONG_SCORE ? 'likely' : 'possible' }));
};

const SECRET_PATTERNS: readonly RegExp[] = [
  /bearer\s+ey[a-z0-9_-]{10,}/i,
  /api-?key['"]?\s*[:=]\s*['"]?[a-z0-9_-]{16,}/i,
  /\b(?:xprv|zprv|yprv)[a-z0-9]{20,}/i,
  /\b[0-9a-f]{64}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:mnemonic|seed phrase|recovery phrase)\s*[:=]/i,
];

/** Does the pasted text look like it contains a credential? (Never echoed back.) */
export const looksLikeSecret = (text: string): boolean =>
  SECRET_PATTERNS.some((p) => p.test(text.slice(0, MAX_INPUT_CHARS)));
