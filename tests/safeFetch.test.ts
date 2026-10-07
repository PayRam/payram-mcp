import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isPrivateAddress,
  parseBaseUrl,
  safeFetch,
  UnsafeUrlError,
} from '../src/utils/safeFetch.js';
import { startMockServer } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockServer>>;
let base: string;

beforeAll(async () => {
  mock = await startMockServer((req, res) => {
    if (req.url === '/redirect-away') {
      res.writeHead(302, { Location: 'http://example.com/elsewhere' }).end();
    } else if (req.url === '/redirect-same') {
      res.writeHead(302, { Location: '/ok' }).end();
    } else if (req.url === '/big') {
      res.writeHead(200).end('x'.repeat(10_000));
    } else if (req.url === '/hang') {
      // never answer
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    }
  });
  base = mock.base;
});

afterAll(() => mock.close());

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:7f00:1', true],
    ['0.0.0.0', true],
    ['2002:7f00:1::1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
  ])('%s → %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe('parseBaseUrl', () => {
  it('normalises a dashboard URL', () => {
    expect(parseBaseUrl('https://pay.example.com/?x=1#y').href).toBe('https://pay.example.com/');
  });
  it.each(['file:///etc/passwd', 'gopher://x', 'https://user:pw@pay.example.com', 'not a url'])(
    'rejects %s',
    (url) => {
      expect(() => parseBaseUrl(url)).toThrow(UnsafeUrlError);
    },
  );
});

describe('safeFetch', () => {
  it('blocks private targets when private access is off (hosted)', async () => {
    await expect(safeFetch(`${base}/ok`, { allowPrivate: false })).rejects.toThrow(
      /Private or reserved/,
    );
    await expect(
      safeFetch(`http://localhost:${new URL(base).port}/ok`, { allowPrivate: false }),
    ).rejects.toThrow(/private or reserved/);
  });

  it('reaches local targets in local mode', async () => {
    const res = await safeFetch(`${base}/ok`, { allowPrivate: true });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('follows same-host redirects and refuses cross-host ones', async () => {
    const same = await safeFetch(`${base}/redirect-same`, { allowPrivate: true });
    expect(same.status).toBe(200);
    const away = await safeFetch(`${base}/redirect-away`, { allowPrivate: true });
    expect(away.status).toBe(302);
    expect(away.redirects.join()).toMatch(/blocked cross-host redirect/);
  });

  it('caps the response size', async () => {
    const res = await safeFetch(`${base}/big`, { allowPrivate: true, maxBytes: 100 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(100);
  });

  it('times out', async () => {
    await expect(safeFetch(`${base}/hang`, { allowPrivate: true, timeoutMs: 300 })).rejects.toThrow(
      /Timed out/,
    );
  });
});
