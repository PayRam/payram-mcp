import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientName, recordToolCall, summariseResult, visitorId } from '../src/analytics/usage.js';

describe('usage analytics', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('summarises troubleshoot hits, misses and listings without reading anything else', () => {
    expect(
      summariseResult('payram_troubleshoot', {
        structuredContent: { matches: [{ id: 'a' }, { id: 'b' }] },
      }),
    ).toEqual({ outcome: 'hit', ids: ['a', 'b'] });
    expect(
      summariseResult('payram_troubleshoot', { structuredContent: { matches: [] } }).outcome,
    ).toBe('miss');
    expect(
      summariseResult('payram_troubleshoot', { structuredContent: { matches: [], index: [] } })
        .outcome,
    ).toBe('ok');
    expect(
      summariseResult('payram_doctor', {
        structuredContent: { healthy: false, failedStage: 'tls' },
      }),
    ).toEqual({
      outcome: 'fail',
      stage: 'tls',
    });
    expect(summariseResult('x', { isError: true }).outcome).toBe('error');
  });

  it('rotates the visitor id daily and never exposes the address', () => {
    const info = { ip: '203.0.113.9', userAgent: 'claude-code/2.1' };
    const day1 = visitorId('s', info, new Date('2026-10-11T10:00:00Z'));
    expect(day1).toBe(visitorId('s', info, new Date('2026-10-11T23:00:00Z')));
    expect(day1).not.toBe(visitorId('s', info, new Date('2026-10-12T01:00:00Z')));
    expect(day1).not.toContain('203');
  });

  it('keeps only a coarse client name', () => {
    expect(clientName('claude-code/2.1.0 (darwin; arm64)')).toBe('claude-code');
    expect(clientName('')).toBe('unknown');
  });

  it('sends nothing unless hosted and configured, and sends no arguments when it does', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubEnv('PAYRAM_MCP_MODE', 'local');
    vi.stubEnv('GA_MEASUREMENT_ID', 'G-TEST');
    vi.stubEnv('GA_API_SECRET', 'secret');
    await recordToolCall({ tool: 'payram_doctor', outcome: 'ok', durationMs: 5 });
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubEnv('PAYRAM_MCP_MODE', 'hosted');
    await recordToolCall({
      tool: 'payram_troubleshoot',
      outcome: 'hit',
      ids: ['worker-down'],
      durationMs: 7,
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('measurement_id=G-TEST');
    const body = JSON.parse(String(init?.body));
    expect(body.events[0].params).toMatchObject({
      tool: 'payram_troubleshoot',
      outcome: 'hit',
      issue_ids: 'worker-down',
    });
    fetchSpy.mockRestore();
  });

  it('never throws when the send fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.stubEnv('PAYRAM_MCP_MODE', 'hosted');
    vi.stubEnv('GA_MEASUREMENT_ID', 'G-TEST');
    vi.stubEnv('GA_API_SECRET', 'secret');
    await expect(
      recordToolCall({ tool: 'x', outcome: 'ok', durationMs: 1 }),
    ).resolves.toBeUndefined();
  });
});
