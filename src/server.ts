import express from 'express';
import { configureApp } from './app.js';
import {
  getBindHost,
  getServerPort,
  getServerToken,
  isHosted,
  isLoopbackHost,
} from './config/runtime.js';
import { getOptionalPayramAccessToken, getOptionalPayramApiKey } from './config/env.js';
import { MCP_SERVER_VERSION } from './generated/buildInfo.js';
import { logger } from './utils/logger.js';

// Entry point. Vercel detects this file (it imports express and listens).
const app = configureApp(express());
const port = getServerPort();

if (isHosted()) {
  app.listen(port, () => {
    logger.info(`PayRam MCP v${MCP_SERVER_VERSION} (hosted) listening on :${port}/mcp`);
  });
} else {
  const host = getBindHost();
  const holdsCredentials = Boolean(getOptionalPayramAccessToken() || getOptionalPayramApiKey());
  if (!isLoopbackHost(host) && holdsCredentials && !getServerToken()) {
    // Fail closed: a network-reachable MCP holding PayRam credentials must authenticate callers.
    logger.error(
      `Refusing to start: HOST=${host} is not loopback and PAYRAM_* credentials are set. ` +
        'Set MCP_SERVER_TOKEN (clients send Authorization: Bearer <token>) and MCP_ALLOWED_HOSTS, or bind to 127.0.0.1 and use an SSH tunnel.',
    );
    process.exit(1);
  }
  const httpServer = app.listen(port, host, () => {
    logger.info(
      `PayRam MCP v${MCP_SERVER_VERSION} (local) listening on http://${host}:${port}/mcp`,
    );
  });
  // Outlive client keep-alive pools (Node's 5 s default races with idle clients).
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
}
