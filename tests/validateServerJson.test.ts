import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'validate-server-json.mjs');
const workDir = mkdtempSync(path.join(tmpdir(), 'payram-server-json-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

// The URL fields of the registry's draft-07 server schema
// (https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json), which the
// publish workflow downloads; tests stay offline, so only the `format: uri` parts are copied.
const uri = { type: 'string', format: 'uri' };
const REGISTRY_URL_FIELDS = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['name', 'version'],
  properties: {
    $schema: uri,
    name: { type: 'string' },
    version: { type: 'string', maxLength: 255 },
    websiteUrl: uri,
    icons: { type: 'array', items: { type: 'object', properties: { src: uri } } },
    repository: { type: 'object', properties: { url: uri } },
  },
};
const serverJson = JSON.parse(readFileSync(path.join(repoRoot, 'server.json'), 'utf8'));

/** Run the publish workflow's validator on `data`, as the workflow runs it. */
const validateServerJson = (name: string, data: object) => {
  const schemaPath = path.join(workDir, 'schema.json');
  const dataPath = path.join(workDir, `${name}.json`);
  writeFileSync(schemaPath, JSON.stringify(REGISTRY_URL_FIELDS));
  writeFileSync(dataPath, JSON.stringify(data));
  const run = spawnSync(process.execPath, [script, schemaPath, dataPath], { encoding: 'utf8' });
  return { status: run.status, output: run.stdout + run.stderr };
};

describe('scripts/validate-server-json.mjs', () => {
  it('accepts the server.json this repo publishes', () => {
    const { status, output } = validateServerJson('server', serverJson);
    expect(output.trim()).toMatch(/server\.json valid$/);
    expect(status).toBe(0);
  });

  it.each([
    ['websiteUrl', { websiteUrl: 'mcp.payram.com' }],
    ['an icon src', { icons: [{ src: 'favicon.png', mimeType: 'image/png' }] }],
    ['the repository url', { repository: { source: 'github', url: 'github.com/PayRam' } }],
  ])('rejects %s that is not a URL', (_field, override) => {
    const { status, output } = validateServerJson('bad-url', { ...serverJson, ...override });
    expect(output).toContain('must match format "uri"');
    expect(status).toBe(1);
  });
});
