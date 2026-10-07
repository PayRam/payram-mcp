/**
 * Where this MCP server runs, and the network posture that follows.
 *
 * hosted — the shared public endpoint (mcp.payram.com on Vercel). Never
 *          holds merchant credentials; outbound fetches are SSRF-guarded.
 * local  — run by a merchant/agent next to their own PayRam. May hold
 *          credentials in env, so it binds to loopback by default.
 */
export type McpMode = 'hosted' | 'local';

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export const getMcpMode = (): McpMode => {
  const explicit = env('PAYRAM_MCP_MODE');
  if (explicit === 'hosted' || explicit === 'local') return explicit;
  return env('VERCEL') ? 'hosted' : 'local';
};

export const isHosted = (): boolean => getMcpMode() === 'hosted';

/** Interface to bind in local mode. Loopback unless explicitly overridden. */
export const getBindHost = (): string => env('HOST') ?? '127.0.0.1';

export const isLoopbackHost = (host: string): boolean =>
  ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase());

/** Extra hostnames accepted in the Host header when not bound to loopback. */
export const getAllowedHosts = (): string[] =>
  (env('MCP_ALLOWED_HOSTS') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

/** Optional bearer token required on /mcp (recommended for any non-loopback bind). */
export const getServerToken = (): string | undefined => env('MCP_SERVER_TOKEN');

export const getServerPort = (): number => {
  const parsed = Number(env('PORT') ?? '3333');
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3333;
};
