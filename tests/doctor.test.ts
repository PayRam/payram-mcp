import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMockServer } from './helpers.js';

vi.mock('../src/utils/releases.js', async (orig) => ({
  ...(await orig<typeof import('../src/utils/releases.js')>()),
  getLatestCoreVersion: async () => '3.8.1',
}));

const { runDoctor } = await import('../src/tools/doctor.js');

interface Seen {
  method?: string;
  url?: string;
  body: string;
}

let mock: Awaited<ReturnType<typeof startMockServer>>;
let base: string;
let seen: Seen[] = [];
let health: Record<string, unknown>;

beforeAll(async () => {
  mock = await startMockServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      if (req.url === '/api/v1/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(health));
      } else if (req.url === '/api/v1/payment' && req.method === 'POST') {
        const ok = req.headers['api-key'] === 'good-key';
        res.writeHead(ok ? 400 : 401, { 'Content-Type': 'application/json' }).end('{"code":3}');
      } else {
        res.writeHead(404).end('<html>not found</html>');
      }
    });
  });
  base = mock.base;
});

afterAll(() => mock.close());

beforeEach(() => {
  vi.stubEnv('PAYRAM_MCP_MODE', 'local');
  seen = [];
  health = {
    status: 'ok',
    db: 'ok',
    version: '3.8.1',
    workers: { 'base-listener': 'RUNNING', 'redis-server': 'FATAL', postgres: 'RUNNING' },
  };
});

describe('payram_doctor', () => {
  it('asks for a URL instead of throwing when nothing is configured', async () => {
    vi.stubEnv('PAYRAM_BASE_URL', undefined);
    const out = await runDoctor({});
    expect(out.failedStage).toBe('input');
    expect(out.likelyCauses[0].fix).toMatch(/baseUrl/);
  });

  it('passes a healthy server and ignores the redis-server false positive', async () => {
    const out = await runDoctor({ baseUrl: base });
    expect(out.healthy).toBe(true);
    expect(out.version).toBe('3.8.1');
    expect(out.findings.find((f) => f.check === 'workers')?.ok).toBe(true);
  });

  it('flags a stopped listener even though health.status is ok', async () => {
    health.workers = { 'trx-listener': 'STOPPED', 'redis-server': 'FATAL' };
    const out = await runDoctor({ baseUrl: base });
    expect(out.healthy).toBe(false);
    expect(out.failedStage).toBe('workers');
    expect(out.findings.find((f) => f.check === 'workers')?.detail).toContain(
      'trx-listener=STOPPED',
    );
  });

  it('does not treat an untagged build as outdated', async () => {
    health.version = 'main';
    const out = await runDoctor({ baseUrl: base });
    expect(out.findings.find((f) => f.check === 'version')?.ok).toBe(true);
    expect(out.warnings.join(' ')).toMatch(/Cannot compare versions/);
  });

  it('flags an outdated server', async () => {
    health.version = '3.5.2';
    const out = await runDoctor({ baseUrl: base });
    expect(out.findings.find((f) => f.check === 'version')?.ok).toBe(false);
    expect(out.nextSteps.join(' ')).toMatch(/upgrade/);
  });

  it('validates an API key with an empty body so nothing is created', async () => {
    const good = await runDoctor({ baseUrl: base, apiKey: 'good-key' });
    expect(good.findings.find((f) => f.check === 'api-key')?.ok).toBe(true);
    const probe = seen.find((s) => s.url === '/api/v1/payment');
    expect(probe?.body).toBe('{}');

    const bad = await runDoctor({ baseUrl: base, apiKey: 'wrong' });
    expect(bad.failedStage).toBe('api-key');
  });

  it('explains a URL that is not PayRam', async () => {
    health = { hello: 'world' };
    const out = await runDoctor({ baseUrl: base });
    expect(out.failedStage).toBe('reachability');
  });

  it('refuses private targets on the hosted server', async () => {
    vi.stubEnv('PAYRAM_MCP_MODE', 'hosted');
    const out = await runDoctor({ baseUrl: base });
    expect(out.failedStage).toBe('input');
    expect(seen).toHaveLength(0);
  });
});
