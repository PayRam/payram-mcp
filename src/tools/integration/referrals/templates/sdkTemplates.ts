// NOTE: These referral SDK snippets are derived from docs/js-sdk.md and payram-external.yaml.
// If the SDK changes, update those docs first and then refresh these templates.
import { SnippetResponse } from '../../common/snippetTypes.js';

export const buildNodeSdkCreateReferralSnippet = (): SnippetResponse => ({
  title: 'Create a Payram referral using the Node SDK',
  snippet: `import {
  Payram,
  RefereeLinkRequest,
  RefereeLinkResponse,
  EventLogRequest,
  EventLogResponse,
  isPayramSDKError,
} from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
  // ignore if advanced configuration is not needed
  config: {
    timeoutMs: 10_000, // optional for advance configuration
    maxRetries: 2, // optional for advance configuration
    retryPolicy: 'safe', // optional for advance configuration
    allowInsecureHttp: false, // optional for advance configuration
  },
});

export async function linkReferee(payload: RefereeLinkRequest): Promise<RefereeLinkResponse> {
  try {
    const referee = await payram.referrals.linkReferee(payload);
    console.log('Linked referee', referee.referenceId, 'to', referee.code);
    return referee;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        isRetryable: error.isRetryable,
      });
    }
    throw error;
  }
}

export async function logReferralEvent(payload: EventLogRequest): Promise<EventLogResponse> {
  try {
    const event = await payram.referrals.logReferralEvent(payload);
    console.log('Logged referral event', event.eventKey, 'status:', event.status);
    return event;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        isRetryable: error.isRetryable,
      });
    }
    throw error;
  }
}

// Example flow: link a referee, then log the configured campaign event.
const referee = await linkReferee({
  email: 'new-user@example.com',
  referrerCode: 'ABC123D',
  referenceID: 'ref_program_signup',
});

await logReferralEvent({
  eventKey: 'first_purchase',
  referenceID: referee.referenceId,
  amount: 25,
});
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/referrals/createReferral.ts',
    description: 'Links a referee and logs a referral event via payram.referrals.* SDK APIs.',
  },
  notes:
    'Payloads map directly to RefereeLinkRequest and EventLogRequest. Configure eventKey per your Payram campaign.',
});

export const buildNodeSdkReferralStatusSnippet = (): SnippetResponse => ({
  title: 'Fetch referrer session/status using the Node SDK',
  snippet: `import { Payram, AuthRequest, AuthResponse, isPayramSDKError } from 'payram';

const payram = new Payram({
  apiKey: process.env.PAYRAM_API_KEY!,
  baseUrl: process.env.PAYRAM_BASE_URL!,
});

export async function getReferrerStatus(payload: AuthRequest): Promise<AuthResponse> {
  try {
    const session = await payram.referrals.authenticateReferrer(payload);
    console.log('Referrer', session.referrer.referenceId, 'status:', session.referrer.status);
    return session;
  } catch (error) {
    if (isPayramSDKError(error)) {
      console.error('Payram Error:', {
        status: error.status,
        requestId: error.requestId,
        isRetryable: error.isRetryable,
      });
    }
    throw error;
  }
}

await getReferrerStatus({
  email: 'referrer@example.com',
  referenceID: 'ref_123',
});
`,
  meta: {
    language: 'typescript',
    framework: 'generic-http',
    filenameSuggestion: 'src/payram/referrals/getReferrerStatus.ts',
    description:
      'Uses payram.referrals.authenticateReferrer to fetch referrer profile + redirect URL.',
  },
  notes:
    'Statuses (active/inactive/etc.) and redirectURL follow the AuthResponse type. Surface these to your UI to show referral progress.',
});
