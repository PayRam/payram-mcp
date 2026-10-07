/** Token pair returned by POST /api/v1/refresh */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

/** Single payment record from payment search */
export interface PaymentData {
  projectName: string;
  blockId?: number;
  referenceId?: string;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  paymentStatus: string;
  currency?: string;
  network?: string;
  createdAt?: string;
  updatedAt?: string;
  invoiceId?: string;
  customerId?: string;
  email?: string;
  amountInUSD?: number;
  amount?: number;
  filledAmountInUSD?: number;
  filledAmount?: number;
  paymasterFee?: number;
  paymasterFeeInUSD?: number;
  onRamperFee?: number;
  onRamperFeeInUSD?: number;
  createdBy: string;
  trxTimestamp?: string;
  webhookStatus?: string;
}

/** Response from POST /api/v1/external-platform/{id}/payment/search */
export interface PaymentSearchResponse {
  data: PaymentData[];
  totalCount: number;
}

/** Response from POST /api/v1/external-platform/{id}/payment/summary */
export interface PaymentSummaryResponse {
  totalCount: number;
  closedCount: number;
  openCount: number;
  cancelledCount: number;
}

/** Single entry from GET /api/v1/addresses/balance */
/** Why the last sweep attempt failed (core: params.SweepErrorSummary). */
export interface SweepErrorSummary {
  statusCode: string; // e.g. LOW_NATIVE_BALANCE, HOT_WALLET_MISSING
  category: string; // recoverable | infra
  reason: string;
  actionHint?: string; // what the merchant can do about it
  retryable: boolean;
  occurredAt: string;
  address: string;
  txHash?: string;
  hotWalletAddress?: string; // set for gas failures: where the human sends native gas
}

export interface AddressBalanceEntry {
  walletName: string;
  walletID: number;
  blockchainCode: string;
  blockchainFamily: string;
  blockchainID: number;
  currencyCode: string;
  currencyAddress?: string;
  currencyID: number;
  amount: string;
  amountUSD?: string;
  addressCount: number;
  startID: number;
  endID: number;
  action: string;
  // Sweep diagnostics (core >= Jun 2026) — explain WHY funds aren't moving.
  walletActive?: boolean;
  hotWalletID?: number;
  hotWalletName?: string;
  hotWalletActive?: boolean;
  hotWalletAddress?: string; // where to send gas when the hot wallet is dry
  coldWalletConfigured?: boolean;
  defaultColdWalletSet?: boolean;
  hasWalletScw?: boolean;
  isSCWDeploymentPending?: boolean;
  nextProbableSweepAt?: string;
  sweepInProgressTxHash?: string;
  lastSweepError?: SweepErrorSummary;
}

/** External platform (project) returned by GET /api/v1/external-platform/details */
export interface ExternalPlatform {
  id: number;
  name: string;
  referenceId?: string;
  createdAt?: string;
}

/** Supported blockchain currency from GET /api/v1/currencies (params.BlockchainCurrencyResponse) */
export interface BlockchainCurrency {
  id: number;
  blockchainCode: string;
  network?: string;
  currencyCode: string;
  currency?: string;
  [key: string]: unknown;
}

/** Withdrawal recipient from GET /api/v1/recipients/ (models.Recipient) */
export interface Recipient {
  id: number;
  name?: string;
  email?: string;
  mobileNumber?: string;
  residentialAddress?: string;
  blockchainCode: string;
  address: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Response from POST /api/v1/payment (checkout link creation) */
export interface PaymentLink {
  url: string;
  reference_id: string;
  host?: string;
  [key: string]: unknown;
}

/** Supervisor worker status from GET /api/v1/system/workers/status (service.SupervisorStatus) */
export interface WorkerStatus {
  name: string;
  status: string;
  details: string;
}

/** Single RPC node health from GET /api/v1/blockchain/{code}/test-connection (params.NodeHealthStatus) */
export interface NodeHealth {
  id?: number;
  url: string;
  connected: boolean;
  error?: string;
  chainId?: number;
  healthScore?: number;
  avgLatencyMs?: number;
  lastBlockSeen?: number;
  lastBlockTimestamp?: string | null;
  [key: string]: unknown;
}

/** Response from GET /api/v1/blockchain/{code}/test-connection (params.TestConnectionResponse) */
export interface NodeConnectionResult {
  success: boolean;
  nodes: NodeHealth[];
}

/** Blockchain config from GET /api/v1/blockchains (models.Blockchain) */
export interface Blockchain {
  code: string;
  name: string;
  family: string;
  status: string;
  [key: string]: unknown;
}

/** Wallet from GET /api/v1/wallets (models.Wallet) */
export interface WalletInfo {
  name: string;
  family?: string;
  blockchainCode?: string;
  currencyCode?: string;
  walletType: string;
  walletSubType?: string;
  address?: string;
  [key: string]: unknown;
}

/** Request body for payment search */
export interface SearchParams {
  query?: string;
  paymentStatus?: string[];
  currency?: string[];
  network?: string[];
  dateFrom?: string;
  dateTo?: string;
  createdBy?: string[];
  webhookStatus?: string[];
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
  externalPlatformIds?: number[];
  limit?: number;
  offset?: number;
}
