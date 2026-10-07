import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../src/app.js';

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
