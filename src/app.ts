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
import { logger } from './utils/logger.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const rpcError = (res: express.Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

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
  const jsonParser = express.json({ limit: '1mb' });
  const parseErrors: express.ErrorRequestHandler = (_err, _req, res, _next) => {
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
  const serveMcp: express.RequestHandler = (req, res, next) => {
    toWebRequest(req, req.body)
      .then((webRequest) => isLegacyRequest(webRequest, req.body))
      .then((isLegacy) => (isLegacy ? legacy(req, res) : modern(req, res, req.body)))
      .catch(next);
  };

  for (const route of ['/mcp', '/']) {
    if (hosted) app.options(route, hostedCors);
    app.post(route, noStore, ...guards, jsonParser, parseErrors, rejectBatch, serveMcp);
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
