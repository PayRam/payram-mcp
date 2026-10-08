import { McpServer } from '@modelcontextprotocol/server';
import { applyToolPolicy } from '../mcp/annotations.js';
import { isHosted } from '../config/runtime.js';
import { registerSetupPlanTool } from './guides/setupPlan.js';
import { registerRunbookTool } from './guides/runbooks.js';
import { registerOpsPlaybookTool } from './guides/opsPlaybook.js';
import { registerTestConnectionTool } from './testConnection.js';
import { registerDoctorTool } from './doctor.js';
import { registerTroubleshootTool } from './troubleshoot.js';
import { registerPaymentTools } from './integration/payments/index.js';
import { registerMultilangPaymentTools } from './integration/multilang-payments/index.js';
import { registerPayoutTools } from './integration/payouts/index.js';
import { registerReferralTools } from './integration/referrals/index.js';
import { registerWebhookTools } from './integration/webhooks/index.js';
import { registerContextTools } from './context/index.js';
import { registerLegacySetupTools, registerSetupTools } from './setup/index.js';
import { registerScaffoldAppTool } from './scaffoldApp.js';
import { registerProjectAssessmentTool } from './integration/assessment/index.js';
import { registerTopUpTools } from './integration/topup/index.js';
import { registerDataTools } from './data/index.js';

export const registerTools = (server: McpServer) => {
  applyToolPolicy(server);
  // Start-here tools first: hosts and models read tools/list top-down.
  registerSetupPlanTool(server);
  registerDoctorTool(server);
  registerTroubleshootTool(server);
  registerRunbookTool(server);
  registerOpsPlaybookTool(server);
  registerSetupTools(server);
  registerPaymentTools(server);
  registerMultilangPaymentTools(server);
  registerPayoutTools(server);
  registerReferralTools(server);
  registerWebhookTools(server);
  registerTopUpTools(server);
  registerContextTools(server);
  registerScaffoldAppTool(server);
  // Tools that read this server's own environment or filesystem only make
  // sense next to the merchant's PayRam. On the hosted server agents use
  // payram_ops_playbook and call the PayRam API themselves.
  if (!isHosted()) {
    registerProjectAssessmentTool(server);
    registerDataTools(server);
  }
  // Superseded entry points stay callable but sit at the end of the list.
  registerTestConnectionTool(server);
  registerLegacySetupTools(server);
};
