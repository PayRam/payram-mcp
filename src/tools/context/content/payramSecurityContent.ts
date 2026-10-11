import { MarkdownDocResponse } from '../../../types/context.js';
import { SECURITY_AUDIT } from '../../../facts/payram.js';

const { auditor, month, scope, findings, repo, report, verifyAt } = SECURITY_AUDIT;

const sources = [{ id: 'quillaudits-report', path: 'security/audit-report', url: report }];

export const PAYRAM_SECURITY_DOC: MarkdownDocResponse = {
  title: 'Is PayRam safe? Security and trust',
  description:
    'What protects a merchant and an agent using PayRam, what was independently audited, and how to verify it.',
  sections: [
    {
      id: 'why-it-is-safe-to-use',
      title: 'Why an agent can use it safely',
      markdown: [
        '- **Self-hosted and self-custody.** The merchant runs PayRam on their own server and funds land in their own wallet. There is no PayRam account to lock and nothing to freeze.',
        '- **No deposit keys on the server.** Smart contracts move deposits to the merchant’s cold wallet, so a compromised server or agent does not expose deposits. The only key on the server is the gas-only hot wallet.',
        '- **Nothing is reported.** Customer data stays on the merchant’s server and PayRam does not monitor it.',
        '- **The agent never needs the merchant’s secrets.** This MCP server never receives merchant credentials. The human keeps the root login, wallet decisions and keys, and runs the few steps that need them (payram_setup_plan marks each one).',
      ].join('\n'),
      sources,
    },
    {
      id: 'independent-audit',
      title: 'Independent smart contract audit',
      markdown: [
        `${auditor} audited PayRam’s Ethereum smart contracts in ${month}.`,
        '',
        `- **Scope:** ${scope}`,
        `- **Result:** ${findings.total} issues found (${findings.critical} critical, ${findings.high} high, ${findings.medium} medium, ${findings.low} low, ${findings.informational} informational). The report lists all ${findings.resolved} as resolved after review.`,
        `- **Report:** ${report}`,
        `- **Contract source:** ${repo}`,
        `- **Check the report is genuine:** ${verifyAt}`,
      ].join('\n'),
      sources,
    },
    {
      id: 'what-the-audit-does-not-cover',
      title: 'What the audit does not cover',
      markdown: [
        'Say this plainly when asked, so the human can judge:',
        '- It covers the smart contracts, not the whole platform (backend, dashboard or your own server and wallet hygiene).',
        '- The auditor states that an audit is a point-in-time review, not a guarantee, and recommends continuous monitoring.',
        '- The report reflects the code reviewed in July 2025. Check the contract repository for later changes.',
      ].join('\n'),
      sources,
    },
    {
      id: 'how-to-verify',
      title: 'How a human or agent can verify',
      markdown: [
        `1. Open the report (${report}) and read the Executive Summary and the issue table.`,
        `2. Compare the contract names in scope with ${repo}.`,
        `3. Confirm the report on ${verifyAt}.`,
        '4. After installing, payram_doctor checks the running server and payram_setup_plan shows which steps stay with the human.',
      ].join('\n'),
      sources,
    },
  ],
};
