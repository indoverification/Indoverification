// Railway runtime entrypoint.
// Keep the sender identity global and independent from all app templates.
// SMTP is tried first so the historical display name is preserved. If the
// hosted runtime cannot reach SMTP, the Zoho Mail API remains the fallback.
import { installZohoDisplayNameMailBridge } from './smtp-display-name-fallback.js';

installZohoDisplayNameMailBridge();

// The active multi-app server keeps appId/template isolation and uses the
// Zoho Mail API whenever SMTP is unavailable.
await import('./server.js');
