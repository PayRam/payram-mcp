import { authenticatedFetch } from './authClient.js';
import { apiErrorMessage } from '../utils/httpHints.js';
import { getPayramBaseUrl, getPayramApiKey } from '../config/env.js';
import type {
  SearchParams,
  PaymentSearchResponse,
  PaymentSummaryResponse,
  AddressBalanceEntry,
  ExternalPlatform,
  BlockchainCurrency,
  Recipient,
  PaymentLink,
  WorkerStatus,
  NodeConnectionResult,
  Blockchain,
  WalletInfo,
} from './types.js';

/** Request fields for POST /api/v1/payment (params.PaymentCreateRequest). */
export interface CreatePaymentLinkParams {
  amountInUSD: number;
  customerID: string;
  // Required: core binds customerEmail with `email` and NO omitempty, so an
  // omitted/empty value fails validation with HTTP 400.
  customerEmail: string;
}

/** Unwrap a list response that may be a bare array or an envelope ({data|recipients|...: [...]}). */
const unwrapList = <T>(payload: unknown, ...keys: string[]): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
};

/**
 * List all external platforms (projects) for the authenticated user.
 * GET /api/v1/external-platform/details
 */
export const listPlatforms = async (): Promise<ExternalPlatform[]> => {
  const response = await authenticatedFetch('/api/v1/external-platform/details', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('List platforms', response.status, body));
  }

  return (await response.json()) as ExternalPlatform[];
};

/**
 * Search payments with filters.
 * POST /api/v1/external-platform/{platformId}/payment/search
 */
export const searchPayments = async (
  platformId: string,
  params: SearchParams,
): Promise<PaymentSearchResponse> => {
  const response = await authenticatedFetch(
    `/api/v1/external-platform/${platformId}/payment/search`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Payment search', response.status, body));
  }

  // Zero-result searches serialize as {"data": null} (nil slice in Go) —
  // normalize so callers can iterate without guards.
  const result = (await response.json()) as PaymentSearchResponse;
  return { ...result, data: result.data ?? [] };
};

/**
 * Get payment summary counts.
 * POST /api/v1/external-platform/{platformId}/payment/summary
 */
export const getPaymentSummary = async (platformId: string): Promise<PaymentSummaryResponse> => {
  const response = await authenticatedFetch(
    `/api/v1/external-platform/${platformId}/payment/summary`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Payment summary', response.status, body));
  }

  return (await response.json()) as PaymentSummaryResponse;
};

/**
 * List supported blockchain currencies. Public endpoint — no auth required.
 * GET /api/v1/currencies
 */
export const listCurrencies = async (): Promise<BlockchainCurrency[]> => {
  const baseUrl = getPayramBaseUrl().replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/v1/currencies`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('List currencies', response.status, body));
  }

  return unwrapList<BlockchainCurrency>(await response.json(), 'data', 'currencies');
};

/**
 * List withdrawal recipients (payout beneficiaries).
 * GET /api/v1/project/all/recipients — recipient listing is project-scoped on
 * current core (the unscoped /recipients group has only write routes);
 * ':project_id = all' is explicitly supported by the middleware.
 */
export const listRecipients = async (): Promise<{ recipients: Recipient[]; total: number }> => {
  const response = await authenticatedFetch('/api/v1/project/all/recipients', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('List recipients', response.status, body));
  }

  // Envelope is {data, total, limit, offset}; core caps the page at 100, so
  // carry `total` through — the page length under-reports on large lists.
  const json = (await response.json()) as { total?: number };
  const recipients = unwrapList<Recipient>(json, 'data', 'recipients');
  const total = typeof json?.total === 'number' ? json.total : recipients.length;
  return { recipients, total };
};

/**
 * Create a payment (checkout) link. Uses the Merchant API-Key header — NOT the
 * JWT Bearer flow — because POST /api/v1/payment is the merchant-facing endpoint.
 * POST /api/v1/payment
 */
export const createPaymentLink = async (params: CreatePaymentLinkParams): Promise<PaymentLink> => {
  const baseUrl = getPayramBaseUrl().replace(/\/+$/, '');
  const apiKey = getPayramApiKey();

  const response = await fetch(`${baseUrl}/api/v1/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'API-Key': apiKey,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Create payment link', response.status, body));
  }

  // Payment creation can answer HTTP 200 with an error body like {"code":5,"message":...}.
  const result = (await response.json()) as PaymentLink & { code?: number };
  if (typeof result.code === 'number' && !result.url) {
    throw new Error(
      apiErrorMessage('Create payment link', response.status, JSON.stringify(result)),
    );
  }
  return result;
};

/**
 * Get supervisor worker (blockchain listener) statuses.
 * GET /api/v1/system/workers/status
 */
export const getWorkersStatus = async (): Promise<WorkerStatus[]> => {
  const response = await authenticatedFetch('/api/v1/system/workers/status', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Workers status', response.status, body));
  }

  // Core's SystemHandler wraps the list as {"status": [...]} — that key first.
  return unwrapList<WorkerStatus>(await response.json(), 'status', 'data', 'workers', 'statuses');
};

/**
 * List configured blockchains.
 * GET /api/v1/blockchains
 */
export const getBlockchains = async (): Promise<Blockchain[]> => {
  const response = await authenticatedFetch('/api/v1/blockchains', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('List blockchains', response.status, body));
  }

  return unwrapList<Blockchain>(await response.json(), 'data', 'blockchains');
};

/**
 * Test all RPC nodes for a blockchain (connectivity + sync staleness).
 * GET /api/v1/blockchain/{blockchainCode}/test-connection
 */
export const testBlockchainConnection = async (
  blockchainCode: string,
): Promise<NodeConnectionResult> => {
  const response = await authenticatedFetch(
    `/api/v1/blockchain/${encodeURIComponent(blockchainCode)}/test-connection`,
    { method: 'GET' },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      apiErrorMessage(`Test connection for ${blockchainCode}`, response.status, body),
    );
  }

  const data = (await response.json()) as Partial<NodeConnectionResult>;
  return {
    success: Boolean(data?.success),
    nodes: Array.isArray(data?.nodes) ? data.nodes : [],
  };
};

/**
 * List all wallets (deposit, hot, cold, gas).
 * GET /api/v1/project/all/wallets — wallet listing is project-scoped on
 * current core (the unscoped GET /wallets was removed); ':project_id = all'
 * is explicitly supported by the middleware.
 */
export const getWallets = async (): Promise<WalletInfo[]> => {
  const response = await authenticatedFetch('/api/v1/project/all/wallets', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('List wallets', response.status, body));
  }

  return unwrapList<WalletInfo>(await response.json(), 'data', 'wallets');
};

/**
 * Get the blockchains/currencies enabled for a project (map of chain code → currency codes).
 * GET /api/v1/project/{projectId}/blockchain-currency
 */
export const getProjectBlockchainCurrency = async (
  projectId: string,
): Promise<Record<string, string[]>> => {
  const response = await authenticatedFetch(
    `/api/v1/project/${encodeURIComponent(projectId)}/blockchain-currency`,
    { method: 'GET' },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Project blockchain-currency', response.status, body));
  }

  // Core returns a bare ARRAY of {blockchainCode, currencyCode} rows (one per
  // enabled pair) — reduce it into the chain -> currencies map callers expect.
  const data = (await response.json()) as unknown;
  const rows = unwrapList<{ blockchainCode?: string; currencyCode?: string }>(
    data,
    'data',
    'supportedBlockchainCurrencies',
  );
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (!row?.blockchainCode || !row?.currencyCode) continue;
    (map[row.blockchainCode] ??= []).push(row.currencyCode);
  }
  return map;
};

/**
 * Restart one supervisor-controlled worker (e.g. a chain's block listener).
 * POST /api/v1/system/workers/{name}/restart — name is whitelist-validated by
 * core (ParseWorkerName); unknown names 400. Requires write_system_settings.
 */
export const restartWorker = async (workerName: string): Promise<{ message?: string }> => {
  const response = await authenticatedFetch(
    `/api/v1/system/workers/${encodeURIComponent(workerName)}/restart`,
    { method: 'POST' },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage(`Restart worker ${workerName}`, response.status, body));
  }

  return (await response.json()) as { message?: string };
};

/**
 * Restart ALL supervisor-controlled workers.
 * POST /api/v1/system/workers/restart
 */
export const restartAllWorkers = async (): Promise<{ message?: string }> => {
  const response = await authenticatedFetch('/api/v1/system/workers/restart', {
    method: 'POST',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Restart all workers', response.status, body));
  }

  return (await response.json()) as { message?: string };
};

/**
 * Get address balances (unswept funds) across all wallets.
 * GET /api/v1/addresses/balance
 */
export const getAddressBalances = async (): Promise<AddressBalanceEntry[]> => {
  const response = await authenticatedFetch('/api/v1/addresses/balance', {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Address balances', response.status, body));
  }

  // A fresh install with no deposits answers JSON null.
  return ((await response.json()) as AddressBalanceEntry[] | null) ?? [];
};

/**
 * Read the canonical site URL (payram.server.url) that payment links,
 * emails and webhook origin are built from.
 * GET /api/v1/system/site-url — admin JWT (read_configuration).
 */
export const getSiteUrl = async (): Promise<unknown> => {
  const response = await authenticatedFetch('/api/v1/system/site-url', { method: 'GET' });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(apiErrorMessage('Site URL', response.status, body));
  }
  return response.json();
};
