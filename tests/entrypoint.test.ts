import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

// Vercel auto-detects an Express entrypoint from files named app, index or server. If it picks
// one that has no default export, every invocation fails with FUNCTION_INVOCATION_FAILED while
// the deployment itself still reports success, so nothing in CI or the preview check catches it.
describe('Vercel entrypoint detection', () => {
  it('has exactly one app/index/server file in src, and it is server.ts', () => {
    const candidates = readdirSync(srcDir).filter((f) =>
      /^(app|index|server)\.[cm]?[jt]s$/.test(f),
    );
    expect(candidates).toEqual(['server.ts']);
  });
});
