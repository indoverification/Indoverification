// Railway runtime entrypoint.
// The shared mail transport stays app-independent: every app gets its own
// template/branding, while the sender identity remains IndoVerification.
import { installZohoDisplayNameMailBridge } from './smtp-display-name-fallback.js';

installZohoDisplayNameMailBridge();

// The active multi-app server keeps appId/template isolation and uses the
// Zoho Mail API whenever SMTP is unavailable.
await import('./server.js');
