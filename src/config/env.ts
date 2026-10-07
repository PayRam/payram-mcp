import { isHosted } from './runtime.js';
import { logger } from '../utils/logger.js';

// Local mode reads ./.env if present (Node's built-in loader; no dotenv needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

/**
 * A credential this server needs is not configured. On the hosted server
 * credentials are always treated as absent (it never holds merchant creds).
 */
export class MissingEnvironmentVariableError extends Error {
  constructor(variableName: string) {
    super(`Missing required environment variable: ${variableName}`);
    this.name = 'MissingEnvironmentVariableError';
  }
}

type CredentialKey =
  | 'PAYRAM_BASE_URL'
  | 'PAYRAM_API_KEY'
  | 'PAYRAM_ACCESS_TOKEN'
  | 'PAYRAM_REFRESH_TOKEN'
  | 'PAYRAM_EXTERNAL_PLATFORM_ID';

let warnedHostedEnv = false;

const read = (key: CredentialKey): string | undefined => {
  const value = process.env[key]?.trim();
  if (!value) return undefined;
  if (isHosted()) {
    if (!warnedHostedEnv) {
      warnedHostedEnv = true;
      logger.error('PAYRAM_* credential env vars are set on a hosted deployment; ignoring them.');
    }
    return undefined;
  }
  return value;
};

const requireCredential = (key: CredentialKey): string => {
  const value = read(key);
  if (!value) throw new MissingEnvironmentVariableError(key);
  return value;
};

export const getPayramBaseUrl = (): string => requireCredential('PAYRAM_BASE_URL');
export const getPayramApiKey = (): string => requireCredential('PAYRAM_API_KEY');
export const getPayramAccessToken = (): string => requireCredential('PAYRAM_ACCESS_TOKEN');
export const getPayramRefreshToken = (): string => requireCredential('PAYRAM_REFRESH_TOKEN');

export const getOptionalPayramBaseUrl = (): string | undefined => read('PAYRAM_BASE_URL');
export const getOptionalPayramApiKey = (): string | undefined => read('PAYRAM_API_KEY');
export const getOptionalPayramAccessToken = (): string | undefined => read('PAYRAM_ACCESS_TOKEN');
export const getPayramExternalPlatformId = (): string | undefined =>
  read('PAYRAM_EXTERNAL_PLATFORM_ID');
