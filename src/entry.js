// Railway runtime entrypoint for the shared multi-app backend.
// Every app uses one shared Zoho SMTP mail service and one global sender.
import { installSharedMailTransport } from './mail-service.js';

installSharedMailTransport();
await import('./server.js');
