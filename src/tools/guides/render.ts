/** Shared markdown rendering for setup plans and runbooks. */

export const WHO_LABEL = {
  agent_shell: 'agent (shell on the server)',
  agent_http: 'agent (MCP/HTTP)',
  human_shell: 'HUMAN (runs this on the server, then pastes the output back)',
  human: 'HUMAN',
  human_dashboard: 'HUMAN (dashboard)',
} as const;

export type Who = keyof typeof WHO_LABEL;

export interface RenderableStep {
  heading: string;
  gate?: string;
  commands?: string;
  expect?: string;
  notes?: readonly string[];
  ifItFails?: string;
}

const indent = (text: string) => text.split('\n').map((l) => `   ${l}`);

/** One numbered step: heading, hard stop, command block, expectation, notes. */
export const renderStepLines = (step: RenderableStep): string[] => {
  const lines = [step.heading];
  if (step.gate) lines.push(`   ⛔ STOP: ${step.gate}`);
  if (step.commands) lines.push('   ```bash', ...indent(step.commands), '   ```');
  if (step.expect) lines.push(`   Expect: ${step.expect}`);
  for (const note of step.notes ?? []) lines.push(`   - ${note}`);
  if (step.ifItFails) lines.push(`   If it fails: ${step.ifItFails}`);
  return lines;
};
