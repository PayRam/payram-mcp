import { CORE_VERSION_VERIFIED, LINKS } from '../facts/payram.js';
import { safeFetch } from './safeFetch.js';
import { logger } from './logger.js';

/**
 * Latest PayRam core version from the public upgrade policy the installer
 * and dashboard updater use. Cached per instance (it is public, not tenant
 * data); concurrent callers share one request, and a failure falls back to
 * the version this server was verified against for a short while.
 */

const TTL_MS = 10 * 60_000;
const FALLBACK_TTL_MS = 60_000;
let cache: { value: string; until: number } | null = null;
let inflight: Promise<string> | null = null;

/** "3.8.1" / "v3.8.1-rc1" → [3, 8, 1]; anything else (e.g. "main") → null. */
export const parseVersion = (v: string): [number, number, number] | null => {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};

/** -1 / 0 / 1, or null when either side is not a version (so callers cannot mistake "main" for 0.0.0). */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 | null => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

const fetchLatest = async (): Promise<string> => {
  try {
    const res = await safeFetch(LINKS.upgradePolicy, { timeoutMs: 4_000, allowPrivate: false });
    const latest = (JSON.parse(res.body) as { latest?: unknown }).latest;
    if (res.status === 200 && typeof latest === 'string' && parseVersion(latest)) {
      cache = { value: latest, until: Date.now() + TTL_MS };
      return latest;
    }
  } catch (error) {
    logger.warn('releases: upgrade policy unavailable', { error: (error as Error).message });
  }
  cache = { value: CORE_VERSION_VERIFIED, until: Date.now() + FALLBACK_TTL_MS };
  return CORE_VERSION_VERIFIED;
};

/** Never rejects. */
export const getLatestCoreVersion = (): Promise<string> => {
  if (cache && Date.now() < cache.until) return Promise.resolve(cache.value);
  inflight ??= fetchLatest().finally(() => {
    inflight = null;
  });
  return inflight;
};
