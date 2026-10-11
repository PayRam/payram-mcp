import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import type express from 'express';
import { isHosted } from '../config/runtime.js';
import { logger } from '../utils/logger.js';

/**
 * Anonymous usage counts for the hosted server, sent to GA4 over the Measurement Protocol.
 *
 * What is sent: the tool name, hit/miss/error, matched troubleshooting ids, the doctor stage, a
 * coarse client name and the duration. What is never sent: tool arguments, pasted text, URLs,
 * hostnames or keys. The visitor id is an HMAC of IP + user agent + day, so it cannot be linked
 * across days and cannot be reversed without the API secret.
 */

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const SEND_TIMEOUT_MS = 700;

interface RequestInfo {
  ip: string;
  userAgent: string;
}

const requestInfo = new AsyncLocalStorage<RequestInfo>();

/** Express middleware: makes the caller's IP and user agent available to recordToolCall. */
export const captureRequestInfo: express.RequestHandler = (req, _res, next) => {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  requestInfo.run(
    {
      ip: forwarded || req.socket.remoteAddress || '',
      userAgent: String(req.headers['user-agent'] ?? ''),
    },
    next,
  );
};

export type ToolOutcome = 'ok' | 'hit' | 'miss' | 'fail' | 'error';

export interface ToolCall {
  tool: string;
  outcome: ToolOutcome;
  ids?: string[];
  stage?: string;
  durationMs: number;
}

const config = () => {
  const measurementId = process.env.GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;
  return isHosted() && measurementId && apiSecret ? { measurementId, apiSecret } : null;
};

/** "claude-code/2.1" -> "claude-code"; keeps GA's 100-character limit and drops anything odd. */
export const clientName = (userAgent: string): string => {
  const first = userAgent.split(/[\s/;(]/)[0] ?? '';
  return first.replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown';
};

export const visitorId = (secret: string, info: RequestInfo, now = new Date()): string =>
  createHmac('sha256', secret)
    .update(`${now.toISOString().slice(0, 10)}|${info.ip}|${info.userAgent}`)
    .digest('hex')
    .slice(0, 32);

/** Reads only the fields below from a tool result; everything else in it is ignored. */
export const summariseResult = (
  tool: string,
  result: { isError?: boolean; structuredContent?: unknown } | undefined,
): Pick<ToolCall, 'outcome' | 'ids' | 'stage'> => {
  if (result?.isError) return { outcome: 'error' };
  const sc = (result?.structuredContent ?? {}) as Record<string, unknown>;
  if (tool === 'payram_troubleshoot') {
    const ids = Array.isArray(sc.matches)
      ? sc.matches.map((m) => String((m as { id?: unknown }).id ?? '')).filter(Boolean)
      : [];
    const listing = Array.isArray(sc.matches) && sc.matches.length === 0 && 'index' in sc;
    return { outcome: ids.length ? 'hit' : listing ? 'ok' : 'miss', ids };
  }
  if (tool === 'payram_doctor') {
    const stage = typeof sc.failedStage === 'string' ? sc.failedStage : undefined;
    return { outcome: sc.healthy === true ? 'ok' : 'fail', stage };
  }
  return { outcome: 'ok' };
};

export const recordToolCall = async (call: ToolCall): Promise<void> => {
  const cfg = config();
  if (!cfg) return;
  const info = requestInfo.getStore() ?? { ip: '', userAgent: '' };
  const body = {
    client_id: visitorId(cfg.apiSecret, info),
    events: [
      {
        name: 'mcp_tool_call',
        params: {
          tool: call.tool,
          outcome: call.outcome,
          issue_ids: (call.ids ?? []).join(',').slice(0, 100),
          stage: call.stage ?? '',
          client: clientName(info.userAgent),
          duration_ms: Math.round(call.durationMs),
          engagement_time_msec: 1,
        },
      },
    ],
  };
  try {
    await fetch(
      `${ENDPOINT}?measurement_id=${encodeURIComponent(cfg.measurementId)}&api_secret=${encodeURIComponent(cfg.apiSecret)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
  } catch (error) {
    // Analytics must never affect a tool call.
    logger.debug('analytics: send failed', { error: (error as Error).message });
  }
};
