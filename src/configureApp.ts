import express from 'express';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  toWebRequest,
} from '@modelcontextprotocol/node';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/express';
import { createPayramMcpServer } from './mcp/createServer.js';
import {
  getAllowedHosts,
  getBindHost,
  getServerToken,
  isHosted,
  isLoopbackHost,
} from './config/runtime.js';
import { MCP_SERVER_VERSION } from './generated/buildInfo.js';
import { LANDING_HTML, LANDING_MARKDOWN } from './web/landing.js';
import { AGENT_DISCOVERY_LINK, MCP_ENDPOINT, buildMcpJson } from './web/discovery.js';
import { captureRequestInfo } from './analytics/usage.js';
import { logger } from './utils/logger.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const rpcError = (res: express.Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

// One request must not be able to exhaust memory while the SDK validates it (GHSA-46jr-4wx8-v453).
// The largest legitimate input is payram_troubleshoot's 20,000-character pasted output, so 256 KB
// leaves room for JSON escaping. Tool arguments are also capped by maxToolInputElements
// (createServer.ts); MAX_MESSAGE_ELEMENTS bounds what the SDK validates without a cap of its own,
// such as prompts/get arguments, and sits above the tool cap so tool calls keep its readable error.
const MAX_BODY_SIZE = '256kb';
const MAX_MESSAGE_ELEMENTS = 2_000;

/** Array elements + own object members in value, counting no further than max + 1. */
const countElements = (value: unknown, max: number): number => {
  let count = 0;
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (++count > max) return count;
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
  return count;
};

/** CORS for browser-based MCP clients. Only on hosted, which holds no credentials. */
const hostedCors: express.RequestHandler = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

const bearerGuard =
  (token: string): express.RequestHandler =>
  (req, res, next) => {
    const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(presented);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
    res.setHeader('WWW-Authenticate', 'Bearer');
    rpcError(
      res,
      401,
      -32001,
      'Unauthorized: this PayRam MCP requires Authorization: Bearer <MCP_SERVER_TOKEN>.',
    );
  };

/** Everything except app.listen — shared by the server entry and tests. */
export const configureApp = (app: express.Express): express.Express => {
  const hosted = isHosted();
  const bindHost = getBindHost();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Served by Vercel's CDN when hosted; express.static covers local runs.
  app.use(express.static(publicDir, { index: false }));

  // ── MCP endpoint ─────────────────────────────────────────────────
  // 2026-07-28 requests: the SDK's stateless modern handler.
  const handler = createMcpHandler(() => createPayramMcpServer(), {
    legacy: 'reject',
    onerror: (error) => logger.warn('mcp: request rejected', { error: error.message }),
  });
  const modern = toNodeHandler(handler);

  // 2025-era requests: a fresh server + transport per request with plain JSON
  // responses (the behaviour existing clients and curl-based agents rely on).
  const legacy = async (req: express.Request, res: express.Response) => {
    const server = createPayramMcpServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const guards: express.RequestHandler[] = [];
  if (hosted) {
    guards.push(hostedCors);
  } else if (isLoopbackHost(bindHost)) {
    guards.push(localhostHostValidation(), localhostOriginValidation());
  } else {
    const allowed = getAllowedHosts();
    if (allowed.length) guards.push(hostHeaderValidation(allowed));
  }
  const token = hosted ? undefined : getServerToken();
  if (token) guards.push(bearerGuard(token));

  const noStore: express.RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const jsonParser = express.json({ limit: MAX_BODY_SIZE });
  const parseErrors: express.ErrorRequestHandler = (err, _req, res, _next) => {
    if ((err as { type?: string }).type === 'entity.too.large') {
      rpcError(res, 413, -32600, `Request too large: the limit is ${MAX_BODY_SIZE}.`);
      return;
    }
    rpcError(res, 400, -32700, 'Parse error: the request body must be a single JSON-RPC message.');
  };
  const rejectBatch: express.RequestHandler = (req, res, next) => {
    if (Array.isArray(req.body)) {
      rpcError(
        res,
        400,
        -32600,
        'Batch requests are not supported. Send one JSON-RPC message per request.',
      );
      return;
    }
    next();
  };
  const rejectOversizedMessage: express.RequestHandler = (req, res, next) => {
    if (countElements(req.body, MAX_MESSAGE_ELEMENTS) > MAX_MESSAGE_ELEMENTS) {
      rpcError(
        res,
        400,
        -32600,
        `Request too large: one message may hold at most ${MAX_MESSAGE_ELEMENTS} array elements and object members.`,
      );
      return;
    }
    next();
  };
  const serveMcp: express.RequestHandler = (req, res, next) => {
    toWebRequest(req, req.body)
      .then((webRequest) => isLegacyRequest(webRequest, req.body))
      .then((isLegacy) => (isLegacy ? legacy(req, res) : modern(req, res, req.body)))
      .catch(next);
  };

  for (const route of ['/mcp', '/']) {
    if (hosted) app.options(route, hostedCors);
    app.post(
      route,
      noStore,
      captureRequestInfo,
      ...guards,
      jsonParser,
      parseErrors,
      rejectBatch,
      rejectOversizedMessage,
      serveMcp,
    );
  }

  const methodNotAllowed: express.RequestHandler = (_req, res) => {
    res.setHeader('Allow', 'POST');
    rpcError(res, 405, -32000, `Method not allowed. POST JSON-RPC messages to ${MCP_ENDPOINT}.`);
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
  app.all('/mcp/sse', (_req, res) => {
    rpcError(
      res,
      410,
      -32000,
      `The SSE transport is not supported. Use Streamable HTTP: POST ${MCP_ENDPOINT}.`,
    );
  });

  // ── Discovery & landing ──────────────────────────────────────────
  app.get('/', (req, res) => {
    res.setHeader('X-MCP-Server', `PayRam MCP Server v${MCP_SERVER_VERSION}`);
    res.setHeader('X-MCP-Endpoint', MCP_ENDPOINT);
    res.setHeader('X-MCP-Transport', 'streamable-http');
    res.setHeader('Link', AGENT_DISCOVERY_LINK);
    res.setHeader('Vary', 'Accept');
    // Browsers get HTML; agents that do not accept HTML get the markdown summary.
    if (req.accepts('html')) res.type('html').send(LANDING_HTML);
    else res.type('text/markdown; charset=utf-8').send(LANDING_MARKDOWN);
  });

  app.get('/.well-known/mcp.json', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(buildMcpJson());
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: 'payram-mcp-server', version: MCP_SERVER_VERSION });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', mcpEndpoint: MCP_ENDPOINT });
  });

  const internalError: express.ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error('http: unhandled error', { error: (err as Error)?.message });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  };
  app.use(internalError);

  return app;
};
