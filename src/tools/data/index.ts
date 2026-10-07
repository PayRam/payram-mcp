import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../utils/logger.js';
import { getPayramExternalPlatformId } from '../../config/env.js';
import { listPlatforms } from '../../api/payramApi.js';
import { registerGetPaymentSummaryTool } from './getPaymentSummary.js';
import { registerLookupPaymentTool } from './lookupPayment.js';
import { registerSearchPaymentsTool } from './searchPayments.js';
import { registerGetUnsweptBalancesTool } from './getUnsweptBalances.js';
import { registerGetDailyVolumeTool } from './getDailyVolume.js';
import { registerListPlatformsTool } from './listPlatforms.js';
import { registerListCurrenciesTool } from './listCurrencies.js';
import { registerListRecipientsTool } from './listRecipients.js';
import { registerCreatePaymentLinkTool } from './createPaymentLink.js';
import { registerCheckNodeSyncTool } from './checkNodeSync.js';
import { registerCheckPaymentReadinessTool } from './checkPaymentReadiness.js';
import { registerRestartWorkerTool } from './restartWorker.js';

/** Cached platform ID so we only auto-discover once per session */
let cachedPlatformId: string | null = null;

/**
 * Resolve external platform ID from:
 *   1. Explicit tool input
 *   2. PAYRAM_EXTERNAL_PLATFORM_ID env var
 *   3. Auto-discover via GET /api/v1/external-platform/details (uses first platform)
 */
export const resolveExternalPlatformId = async (input?: string): Promise<string> => {
  // 1. Explicit input
  if (input) return input;

  // 2. Env var
  const envId = getPayramExternalPlatformId();
  if (envId) return envId;

  // 3. Auto-discover (cached)
  if (cachedPlatformId) return cachedPlatformId;

  logger.info('No platform ID provided, auto-discovering from API...');
  const platforms = await listPlatforms();
  if (!platforms || platforms.length === 0) {
    throw new Error(
      'No external platforms found for this account. Create a project in the PayRam dashboard first.',
    );
  }

  cachedPlatformId = String(platforms[0].id);
  logger.info(`Auto-discovered platform: ${platforms[0].name} (ID: ${cachedPlatformId})`);
  return cachedPlatformId;
};

export const registerDataTools = (server: McpServer) => {
  logger.debug('Registering data tools...');
  registerListPlatformsTool(server);
  registerGetPaymentSummaryTool(server);
  registerLookupPaymentTool(server);
  registerSearchPaymentsTool(server);
  registerGetUnsweptBalancesTool(server);
  registerGetDailyVolumeTool(server);
  registerListCurrenciesTool(server);
  registerListRecipientsTool(server);
  registerCreatePaymentLinkTool(server);
  registerCheckNodeSyncTool(server);
  registerRestartWorkerTool(server);
  registerCheckPaymentReadinessTool(server);
};
