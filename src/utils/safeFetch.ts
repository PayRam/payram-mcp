import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';
import { isHosted } from '../config/runtime.js';

/**
 * Outbound HTTP for tools that take a caller-supplied URL (payram_doctor,
 * test_payram_connection).
 *
 * On the hosted server a caller must not be able to make us reach internal
 * addresses (SSRF). The guard lives in the socket's own DNS lookup, so the
 * address that is checked is the address that is connected to — no gap for
 * DNS rebinding between "check" and "connect".
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96], // IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['100::', 64],
  ['2001::', 32], // Teredo (can embed IPv4)
  ['2002::', 16], // 6to4 (can embed IPv4)
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

export const isPrivateAddress = (address: string): boolean => {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an IP at all: treat as unsafe
};

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Allow loopback/private targets. Defaults to true in local mode, false when hosted. */
  allowPrivate?: boolean;
}

export interface TlsInfo {
  authorized: boolean;
  validTo?: string;
  daysRemaining?: number;
  issuer?: string;
}

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  truncated: boolean;
  finalUrl: string;
  redirects: string[];
  tls?: TlsInfo;
}

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 256 * 1024, maxRedirects: 3 };

/** Validate a caller-supplied base URL and return it normalised (no trailing slash). */
export const parseBaseUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError(`"${value}" is not a valid URL. Use e.g. https://pay.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed.');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
};

const guardedLookup =
  (allowPrivate: boolean): net.LookupFunction =>
  (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses as dns.LookupAddress[];
      if (!list.length) return callback(new Error(`No addresses for ${hostname}`), '', 4);
      if (!allowPrivate) {
        const bad = list.find((a) => isPrivateAddress(a.address));
        if (bad) {
          return callback(
            new UnsafeUrlError(
              `${hostname} resolves to a private or reserved address; the hosted MCP only checks public servers.`,
            ),
            '',
            4,
          );
        }
      }
      if ((options as dns.LookupOptions).all) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };

type ResolvedOptions = SafeFetchOptions & typeof DEFAULTS & { allowPrivate: boolean };
type SingleResponse = Omit<SafeFetchResult, 'finalUrl' | 'redirects'>;

const requestOnce = (url: URL, opts: ResolvedOptions) =>
  new Promise<SingleResponse>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !opts.allowPrivate && isPrivateAddress(host)) {
      reject(
        new UnsafeUrlError('Private or reserved IP addresses are not allowed from the hosted MCP.'),
      );
      return;
    }
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': 'payram-mcp',
          Accept: 'application/json, */*;q=0.5',
          ...opts.headers,
        },
        lookup: guardedLookup(opts.allowPrivate),
      },
      (res) => {
        let tls: TlsInfo | undefined;
        if (url.protocol === 'https:') {
          const socket = res.socket as TLSSocket;
          const cert = socket.getPeerCertificate?.();
          const validTo = cert?.valid_to;
          const expires = validTo ? Date.parse(validTo) : NaN;
          tls = {
            authorized: socket.authorized ?? false,
            validTo,
            daysRemaining: Number.isFinite(expires)
              ? Math.floor((expires - Date.now()) / 86_400_000)
              : undefined,
            issuer: typeof cert?.issuer?.O === 'string' ? cert.issuer.O : undefined,
          };
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        // 'close' fires after 'end' and after a truncating destroy: settle once there.
        res.on('close', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
            tls,
          }),
        );
        res.on('error', (e) => {
          if (!truncated) reject(e);
        });
      },
    );
    // One absolute deadline covers connect, headers and body.
    const deadline = setTimeout(
      () => req.destroy(new Error(`Timed out after ${opts.timeoutMs} ms`)),
      opts.timeoutMs,
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });

/**
 * Fetch with SSRF protection, a timeout, a response-size cap and bounded
 * redirects. Redirects are followed only within the same host (http→https
 * upgrades included); credentials headers are never sent to another host.
 */
export const safeFetch = async (
  target: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> => {
  const opts: ResolvedOptions = {
    ...DEFAULTS,
    ...options,
    allowPrivate: options.allowPrivate ?? !isHosted(),
  };
  let url = typeof target === 'string' ? new URL(target) : new URL(target.href);
  const origin = url.hostname;
  const redirects: string[] = [];
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, opts);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location && hop < opts.maxRedirects) {
      const next = new URL(location, url);
      if (next.hostname !== origin || (next.protocol !== 'https:' && next.protocol !== 'http:')) {
        return {
          ...res,
          finalUrl: url.href,
          redirects: [...redirects, `blocked cross-host redirect to ${next.origin}`],
        };
      }
      redirects.push(next.href);
      url = next;
      continue;
    }
    return { ...res, finalUrl: url.href, redirects };
  }
};

/** A short, single-line excerpt of an upstream body that is safe to show an agent. */
export const excerpt = (body: string, max = 160): string => {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
