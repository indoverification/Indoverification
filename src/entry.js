// Railway runtime entrypoint.
// The sender identity is global and independent from all app templates.
// When the existing Zoho SMTP + App Password variables are available, the
// shared mail API calls are delivered through SMTP with a fixed display name.
import { installSmtpMailBridge } from './smtp-mail-bridge.js';

installSmtpMailBridge();

// The compatibility server.js normalizes deployment environment values and
// starts the isolated multi-app runtime. The legacy server-v2.js is retained
// separately for rollback/comparison and is not the active entrypoint.
await import('./server.js');
