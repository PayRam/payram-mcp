import { SUPPORTED_PROTOCOL_VERSIONS as LEGACY_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { MCP_REGISTRY_NAME, MCP_SERVER_VERSION } from '../generated/buildInfo.js';
import { SERVER_NAME } from '../mcp/createServer.js';
import { LINKS, NATIVE_CHAINS, SMART_BRIDGE } from '../facts/payram.js';

export const MCP_ENDPOINT = LINKS.mcp;

/** The 2026-07-28 revision (modern handler) plus every 2025-era version the SDK serves. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', ...LEGACY_PROTOCOL_VERSIONS];

/** Agent-discovery Link header (RFC 8288, registered rel types only). */
export const AGENT_DISCOVERY_LINK = [
  '</SKILL.md>; rel="start"; type="text/markdown"; title="PayRam agent front door"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="related"; type="application/json"; title="Agent Skills Index"',
  `<${MCP_ENDPOINT}>; rel="service"; title="PayRam MCP Server"`,
  `<${LINKS.docs}>; rel="service-doc"; type="text/html"`,
  '</llms.txt>; rel="alternate"; type="text/plain"; title="LLM-friendly summary"',
].join(', ');

/** Legacy /.well-known/mcp.json document, kept for agents that probe it. */
export const buildMcpJson = () => ({
  name: MCP_REGISTRY_NAME,
  version: MCP_SERVER_VERSION,
  serverInfo: {
    name: SERVER_NAME,
    title: 'PayRam',
    version: MCP_SERVER_VERSION,
    vendor: { name: 'PayRam', url: 'https://payram.com' },
  },
  description:
    'Install, configure, operate and integrate self-hosted PayRam crypto and stablecoin payment gateways. The hosted server never holds merchant credentials.',
  transport: { type: 'streamable-http', endpoint: MCP_ENDPOINT },
  protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  endpoints: {
    streamable_http: MCP_ENDPOINT,
    health: `${LINKS.site}/healthz`,
    server_card: `${LINKS.site}/.well-known/mcp/server-card.json`,
    skills_index: `${LINKS.site}/.well-known/agent-skills/index.json`,
  },
  capabilities: {
    tools: { listChanged: true },
    resources: { listChanged: true },
    prompts: { listChanged: true },
  },
  start_here: {
    install: 'payram_setup_plan',
    check_a_server: 'payram_doctor',
    admin_tasks: 'payram_runbook',
    daily_operations: 'payram_ops_playbook',
  },
  supported_chains: {
    native: NATIVE_CHAINS.map((c) => c.code),
    smart_bridge: SMART_BRIDGE.rails.map((r) => r.origin),
  },
  authentication: {
    mcp_server: 'None. No API key is needed to connect.',
    payram_apis:
      "The hosted server never receives merchant credentials. Agents call the merchant's PayRam API directly (see payram_ops_playbook): dashboard login (JWT) for admin/ops routes, project API key for payment APIs.",
  },
  repository: 'https://github.com/PayRam/payram-mcp',
});
