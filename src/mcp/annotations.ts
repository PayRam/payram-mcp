import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server';

/**
 * Tool annotation policy. Hosts use these hints to decide what to auto-run
 * and what to confirm with the user; the spec defaults (destructive,
 * open-world) would make every tool look dangerous, and ChatGPT app review
 * requires them to be explicit.
 */

const CONTENT: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const REMOTE_READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Tools that touch a PayRam server or change state. Everything else must be content. */
const EXPLICIT: Record<string, ToolAnnotations> = {
  payram_doctor: REMOTE_READ,
  test_payram_connection: REMOTE_READ,
  list_platforms: REMOTE_READ,
  get_payment_summary: REMOTE_READ,
  lookup_payment: REMOTE_READ,
  search_payments: REMOTE_READ,
  get_unswept_balances: REMOTE_READ,
  get_daily_volume: REMOTE_READ,
  list_currencies: REMOTE_READ,
  list_recipients: REMOTE_READ,
  check_node_sync: REMOTE_READ,
  check_payment_readiness: REMOTE_READ,
  // Creating a payment cancels the same customer's other open payments.
  create_payment_link: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  restart_payram_worker: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

/** Name patterns of pure content/codegen tools (no network, no state). */
const CONTENT_NAME =
  /^(generate_|snippet_|explain_|get_payram_|get_referral_|get_agent_|list_payram_docs$|suggest_|scaffold_|assess_|prepare_|onboard_|payram_setup_plan$|payram_runbook$|payram_ops_playbook$)/;

export const annotationsFor = (name: string): ToolAnnotations => {
  const explicit = EXPLICIT[name];
  if (explicit) return explicit;
  if (CONTENT_NAME.test(name)) return CONTENT;
  throw new Error(
    `Tool "${name}" has no annotation policy. Add it to EXPLICIT in src/mcp/annotations.ts or pass annotations when registering.`,
  );
};

/**
 * Make every registerTool call on this instance carry annotations: the
 * tool's own (if given) layered over the policy.
 */
export const applyAnnotationPolicy = (server: McpServer): void => {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (
    name: unknown,
    config: unknown,
    cb: unknown,
  ) => {
    const cfg = (config ?? {}) as { annotations?: ToolAnnotations; title?: string };
    const annotations: ToolAnnotations = {
      ...(cfg.annotations ? {} : annotationsFor(String(name))),
      ...(cfg.title ? { title: cfg.title } : {}),
      ...cfg.annotations,
    };
    return original(name, { ...cfg, annotations }, cb);
  };
};
