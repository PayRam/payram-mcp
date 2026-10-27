import express from 'express';
import { once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../src/configureApp.js';

const ACCEPT = 'application/json, text/event-stream';
const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
};
const discover = {
  jsonrpc: '2.0',
  id: 2,
  method: 'server/discover',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 't', version: '0' },
    },
  },
};

const appFor = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return configureApp(express());
};

beforeEach(() => {
  vi.stubEnv('MCP_SERVER_TOKEN', undefined);
  vi.stubEnv('HOST', undefined);
});

describe('MCP transport (local mode)', () => {
  it('answers 2025-era clients with plain JSON', async () => {
    const res = await request(appFor({ PAYRAM_MCP_MODE: 'local' }))
      .post('/mcp')
      .set('Accept', ACCEPT)
      .send(init);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.result.protocolVersion).toBe('2025-11-25');
    expect(res.body.result.serverInfo.name).toBe('payram-helper');
  });

  it('answers 2026-07-28 server/discover', async () => {
    const res = await request(appFor({ PAYRAM_MCP_MODE: 'local' }))
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('MCP-Protocol-Version', '2026-07-28')
      .set('Mcp-Method', 'server/discover')
      .send(discover);
    expect(res.status).toBe(200);
    const body = res.headers['content-type']?.includes('json')
      ? res.body
      : JSON.parse(res.text.split('data: ')[1]);
    expect(body.result.supportedVersions).toContain('2026-07-28');
  });

  it('rejects batches, bad JSON, and non-POST methods', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'local' });
    const batch = await request(app).post('/mcp').set('Accept', ACCEPT).send([init]);
    expect(batch.status).toBe(400);
    expect(batch.body.error.code).toBe(-32600);

    const bad = await request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(-32700);

    const get = await request(app).get('/mcp');
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');

    const sse = await request(app).get('/mcp/sse');
    expect(sse.status).toBe(410);
  });

  it('rejects foreign Origin and Host headers on a loopback bind', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'local' });
    const origin = await request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('Origin', 'https://evil.example')
      .send(init);
    expect(origin.status).toBe(403);
    const host = await request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('Host', 'evil.example')
      .send(init);
    expect(host.status).toBe(403);
  });

  it('requires the bearer token when MCP_SERVER_TOKEN is set', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'local', MCP_SERVER_TOKEN: 's3cret-token' });
    const denied = await request(app).post('/mcp').set('Accept', ACCEPT).send(init);
    expect(denied.status).toBe(401);
    const allowed = await request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('Authorization', 'Bearer s3cret-token')
      .send(init);
    expect(allowed.status).toBe(200);
  });
});

describe('hosted mode', () => {
  it('allows CORS preflight and never advertises SSE', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const pre = await request(app).options('/mcp');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');

    const card = await request(app).get('/.well-known/mcp.json');
    expect(JSON.stringify(card.body)).not.toMatch(/sse/i);
    expect(card.body.start_here.install).toBe('payram_setup_plan');
  });

  it('serves markdown to agents and HTML to browsers', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const md = await request(app).get('/').set('Accept', 'text/markdown');
    expect(md.headers['content-type']).toMatch(/markdown/);
    expect(md.text).toContain('payram_setup_plan');
    expect(md.headers.link).toContain('rel="service"');

    const html = await request(app).get('/').set('Accept', 'text/html');
    expect(html.text).toContain('<!DOCTYPE html>');
    expect(html.text).not.toMatch(/create-payee|mcp\/sse|\bTON\b/);
  });
});

// GHSA-46jr-4wx8-v453: without a cap, one request of a few hundred KB made the SDK build one
// validation issue per array element (an 800 KB tools/call cost ~280 MB of heap). Both protocol
// eras build their server through createPayramMcpServer, so both must refuse early.
describe('one request cannot exhaust memory during validation', () => {
  type Era = 'legacy' | 'modern';
  const ERAS: Era[] = ['legacy', 'modern'];
  const meta = discover.params._meta;

  /** POST one JSON-RPC request the way a client of that era sends it; returns the parsed reply. */
  const rpc = async (app: express.Express, era: Era, method: string, params: object) => {
    const base = request(app).post('/mcp').set('Accept', ACCEPT);
    const res =
      era === 'legacy'
        ? await base.send({ jsonrpc: '2.0', id: 1, method, params })
        : await base
            .set('MCP-Protocol-Version', '2026-07-28')
            .set('Mcp-Method', method)
            .set('Mcp-Name', String((params as { name?: string }).name ?? ''))
            .send({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } });
    const body = res.headers['content-type']?.includes('json')
      ? res.body
      : JSON.parse(res.text.split('data: ')[1]);
    return { status: res.status, body };
  };
  const callTool = (app: express.Express, era: Era, name: string, args: object) =>
    rpc(app, era, 'tools/call', { name, arguments: args });
  const textOf = (result: { content?: { text?: string }[] }) =>
    (result.content ?? []).map((c) => c.text ?? '').join('\n');
  /** n distinct extra keys, each one element. */
  const extraKeys = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 0]));

  it('refuses a body over 256 KB as too large, not as a parse error', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const res = await request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .send({ ...init, params: { ...init.params, pad: 'x'.repeat(300 * 1024) } });
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe('Request too large: the limit is 256kb.');
  });

  it.each(ERAS)('%s: a normal tools/call still works', async (era) => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const { status, body } = await callTool(app, era, 'payram_troubleshoot', {
      symptom: 'webhook returns 401',
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    expect(textOf(body.result)).toContain('webhook-signature-mismatch');
  });

  it.each(ERAS)('%s: arguments over 1,000 elements are refused before validation', async (era) => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const { status, body } = await callTool(app, era, 'payram_troubleshoot', {
      symptom: 'webhook returns 401',
      ...extraKeys(1_000),
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    // The SDK's counter, not the schema, answered: the handler never ran.
    expect(textOf(body.result)).toBe(
      'Invalid arguments for tool payram_troubleshoot: arguments contain more than the maximum of 1000 elements',
    );
  });

  it('the cap is exactly 1,000: 1,000 elements reach schema validation, 1,001 do not', async () => {
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    // generate_webhook_handler's schema is strict, so extra keys fail validation once they get there.
    const at = await callTool(app, 'legacy', 'generate_webhook_handler', {
      framework: 'express',
      ...extraKeys(999),
    });
    expect(textOf(at.body.result)).toMatch(/^Input validation error/);
    const over = await callTool(app, 'legacy', 'generate_webhook_handler', {
      framework: 'express',
      ...extraKeys(1_000),
    });
    expect(textOf(over.body.result)).toMatch(/more than the maximum of 1000 elements$/);
  });

  it.each(ERAS)('%s: a 100,000-element array is refused cheaply (local mode)', async (era) => {
    // search_payments takes string arrays: unbounded, the SDK would build 100,000 issues and a
    // multi-megabyte error message. Refused up front, the reply stays one short line.
    const app = appFor({ PAYRAM_MCP_MODE: 'local' });
    const { status, body } = await callTool(app, era, 'search_payments', {
      network: Array(100_000).fill(0),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32600);
    expect(JSON.stringify(body).length).toBeLessThan(300);
  });

  it.each(ERAS)(
    '%s: a filter array under the caps still gets a short error (local mode)',
    async (era) => {
      // 900 network entries pass both element caps, so the schema answers. Without a maxItems,
      // the SDK reported every element: an 8 KB request got a 173 KB reply.
      const app = appFor({ PAYRAM_MCP_MODE: 'local' });
      const { status, body } = await callTool(app, era, 'search_payments', {
        network: Array(900).fill('x'.repeat(8)),
      });
      expect(status).toBe(200);
      expect(body.result.isError).toBe(true);
      expect(textOf(body.result)).toMatch(/^Input validation error/);
      expect(JSON.stringify(body).length).toBeLessThan(2_000);
    },
  );

  it.each(ERAS)('%s: prompts/get arguments are bounded too', async (era) => {
    // The SDK has no element cap outside tools/call; the message cap covers the rest.
    const app = appFor({ PAYRAM_MCP_MODE: 'hosted' });
    const big = await rpc(app, era, 'prompts/get', {
      name: 'setup-payram',
      arguments: extraKeys(5_000),
    });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toContain('at most 2000');
    const ok = await rpc(app, era, 'prompts/get', {
      name: 'setup-payram',
      arguments: { domain: 'pay.example.com' },
    });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body.result.messages)).toContain('pay.example.com');
  });
});

describe('hostile request bodies cannot take the server down', () => {
  // GHSA-27r3-jxmh-p828: body-parser before 2.4.0 left its decoder piped to the request after a
  // successful read. A gzip body padded with one zero byte finishes the read early; a second gzip
  // member in a later chunk then made the decoder push after its end, an error nothing listened
  // for, which ended the process. Hosted POST /mcp is public and parses compressed JSON.
  it('a gzip body followed by another gzip member gets an answer, and the process survives', async () => {
    const uncaught: unknown[] = [];
    const recordUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', recordUncaught);
    const server = appFor({ PAYRAM_MCP_MODE: 'hosted' }).listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      const bodyRead = new Promise<void>((resolve) =>
        server.once('request', (req: http.IncomingMessage) => req.once('end', resolve)),
      );
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          Accept: ACCEPT,
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Transfer-Encoding': 'chunked',
        },
      });
      req.write(Buffer.concat([gzipSync(JSON.stringify(init)), Buffer.from([0])]));
      const [res] = (await once(req, 'response')) as [http.IncomingMessage];
      res.resume();
      await once(res, 'end');
      // The parser has finished; now the trailing member arrives.
      req.end(gzipSync('a second gzip member'));
      await bodyRead;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(res.statusCode).toBe(200);
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', recordUncaught);
      server.closeAllConnections();
      server.close();
    }
  });

  // GHSA-mrhx-c7xc-m3w5: zod through 4.6.5 validated every element of an over-long array before
  // checking its length, so one request could allocate an issue per element. The MCP SDK checks
  // every JSON-RPC message with the zod it resolves itself, which need not be the copy the tool
  // schemas import (it was 4.6.5, next to the app's 4.6.7).
  it('the zod the MCP SDK validates with checks an array’s length before its elements', () => {
    const serverEntry = createRequire(import.meta.url).resolve('@modelcontextprotocol/server');
    const coreEntry = createRequire(serverEntry).resolve('@modelcontextprotocol/core');
    for (const entry of [serverEntry, coreEntry]) {
      const { z } = createRequire(entry)('zod') as typeof import('zod');
      const result = z.array(z.string()).max(10).safeParse(Array(100_000).fill(0));
      expect(
        result.error?.issues.map((issue) => issue.code),
        entry,
      ).toEqual(['too_big']);
    }
  });
});
