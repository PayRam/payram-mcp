import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { withClient } from './helpers.js';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(testsDir, '.gen-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const API_KEY = 'pk_test_codegen';
const sign = (body: string, key = API_KEY) =>
  `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

/** Call a generator tool and return its structured result. */
const generate = (name: string, args: Record<string, unknown>) =>
  withClient('modern', async (client) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, name).toBeFalsy();
    return result.structuredContent as { snippet: string };
  });

const hasTool = (bin: string, args: string[]) => {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const FRAMEWORKS = ['express', 'nextjs', 'fastapi', 'gin', 'laravel', 'spring-boot'];

describe('generate_webhook_handler', () => {
  it.each(FRAMEWORKS)('%s verifies the signature, not a shared header', async (framework) => {
    const { snippet } = await generate('generate_webhook_handler', { framework });
    expect(snippet).toContain('X-Payram-Signature');
    expect(snippet).toContain('X-Webhook-Test');
    expect(snippet).toMatch(/hmac|Hmac|HMAC/);
    expect(snippet).not.toContain('PAYRAM_WEBHOOK_SECRET');
    expect(snippet).not.toMatch(/API-Key/i);
  });

  describe('generated Express handler', () => {
    let app: express.Express;
    let calls: unknown[] = [];

    it('is mounted for the tests', async () => {
      const { snippet } = await generate('generate_webhook_handler', { framework: 'express' });
      mkdirSync(path.join(workDir, 'routes'));
      mkdirSync(path.join(workDir, 'services'));
      writeFileSync(path.join(workDir, 'routes/payramWebhook.ts'), snippet);
      writeFileSync(
        path.join(workDir, 'services/payramWebhookRouter.ts'),
        'export const calls: unknown[] = [];\nexport const handlePayramEvent = async (p: unknown) => { calls.push(p); };\n',
      );
      writeFileSync(path.join(workDir, 'services/payramWebhookTypes.ts'), 'export {};\n');
      process.env.PAYRAM_API_KEY = API_KEY;
      const mod = await import(pathToFileURL(path.join(workDir, 'routes/payramWebhook.ts')).href);
      const stub = await import(
        pathToFileURL(path.join(workDir, 'services/payramWebhookRouter.ts')).href
      );
      app = express().use(mod.default);
      calls = stub.calls;
    });

    const body = JSON.stringify({ reference_id: 'r1', status: 'FILLED', amount: '49.99' });
    const post = (b: string, headers: Record<string, string>) =>
      request(app)
        .post('/api/payram/webhook')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(b);

    it('accepts a correctly signed event and passes the parsed payload on', async () => {
      const res = await post(body, { 'X-Payram-Signature': sign(body) });
      expect(res.status).toBe(200);
      expect(calls.at(-1)).toMatchObject({ reference_id: 'r1', status: 'FILLED' });
    });

    it('rejects missing, wrong-key and tampered signatures', async () => {
      const before = calls.length;
      expect((await post(body, {})).status).toBe(401);
      expect((await post(body, { 'X-Payram-Signature': sign(body, 'other') })).status).toBe(401);
      expect((await post(body + ' ', { 'X-Payram-Signature': sign(body) })).status).toBe(401);
      expect((await post(body, { 'API-KEY': API_KEY })).status).toBe(401);
      expect(calls.length).toBe(before);
    });

    it('answers a signed test ping without dispatching it', async () => {
      const before = calls.length;
      const ping = JSON.stringify({ event_type: 'payout.ping', timestamp: 1 });
      const res = await post(ping, { 'X-Payram-Signature': sign(ping), 'X-Webhook-Test': 'true' });
      expect(res.status).toBe(200);
      expect(calls.length).toBe(before);
    });
  });
});

describe('generated Next.js handler', () => {
  it('verifies the signature over the raw body', async () => {
    const { snippet } = await generate('generate_webhook_handler', { framework: 'nextjs' });
    mkdirSync(path.join(workDir, 'next'));
    const dir = path.join(workDir, 'next');
    writeFileSync(
      path.join(dir, 'server-stub.ts'),
      'export type NextRequest = Request;\nexport const NextResponse = { json: (b: unknown, init?: ResponseInit) => Response.json(b, init) };\n',
    );
    writeFileSync(
      path.join(dir, 'handler-stub.ts'),
      'export const handlePayramEvent = async () => {};\n',
    );
    writeFileSync(path.join(dir, 'types-stub.ts'), 'export {};\n');
    writeFileSync(
      path.join(dir, 'route.ts'),
      snippet
        .replace("'next/server'", "'./server-stub'")
        .replace("'@/lib/payram/handlePayramEvent'", "'./handler-stub'")
        .replace("'@/lib/payram/webhookTypes'", "'./types-stub'"),
    );
    process.env.PAYRAM_API_KEY = API_KEY;
    const { POST } = await import(pathToFileURL(path.join(dir, 'route.ts')).href);
    const body = JSON.stringify({ reference_id: 'r1', status: 'FILLED' });
    const send = (headers: Record<string, string>, payload = body) =>
      POST(new Request('http://x/api/payram/webhook', { method: 'POST', body: payload, headers }));
    expect((await send({ 'X-Payram-Signature': sign(body) })).status).toBe(200);
    expect((await send({})).status).toBe(401);
    expect((await send({ 'X-Payram-Signature': sign(body) }, body + ' ')).status).toBe(401);
  });
});

describe('scaffold_payram_app output is valid code', () => {
  const scaffold = (language: string, framework: string) =>
    withClient('modern', async (client) => {
      const result = await client.callTool({
        name: 'scaffold_payram_app',
        arguments: { language, framework },
      });
      return (result.structuredContent as { files: { path: string; contents: string }[] }).files;
    });

  const write = (dir: string, files: { path: string; contents: string }[]) => {
    for (const f of files) {
      const target = path.join(dir, f.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, f.contents);
    }
  };

  it.skipIf(!hasTool('python3', ['--version']))('FastAPI main.py compiles', async () => {
    const dir = path.join(workDir, 'fastapi');
    write(dir, await scaffold('python', 'fastapi'));
    execFileSync('python3', ['-I', '-m', 'py_compile', path.join(dir, 'main.py')]);
  });

  it('Express index.js parses', async () => {
    const dir = path.join(workDir, 'express');
    const files = await scaffold('node', 'express');
    write(dir, files);
    const entry = files.find((f) => /(^|\/)index\.js$/.test(f.path));
    expect(entry).toBeDefined();
    const mjs = path.join(dir, 'check.mjs');
    writeFileSync(mjs, entry!.contents);
    execFileSync('node', ['--check', mjs]);
  });

  it.skipIf(!hasTool('gofmt', ['-h']))('Gin main.go parses', async () => {
    const dir = path.join(workDir, 'gin');
    const files = await scaffold('go', 'gin');
    write(dir, files);
    const entry = files.find((f) => f.path.endsWith('.go'));
    execFileSync('gofmt', ['-e', path.join(dir, entry!.path)], { stdio: 'pipe' });
  });
});
