// Railway runtime entrypoint.
// Keep sender identity configuration global and independent from app templates.
import { ensureZohoSenderDisplayName } from './zoho-sender-identity.js';

try {
  await ensureZohoSenderDisplayName();
} catch (error) {
  // Mail delivery must not be taken offline just because a display-name
  // update is unavailable for the current OAuth scope/account configuration.
  // The shared sender address and app-specific templates continue to work.
  console.warn('Zoho sender display-name enforcement skipped:', error instanceof Error ? error.message : error);
}

// The compatibility server.js normalizes deployment environment values and
// starts the isolated multi-app runtime. The legacy server-v2.js is retained
// separately for rollback/comparison and is not the active entrypoint.
await import('./server.js');
