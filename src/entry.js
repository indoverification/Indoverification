// Railway runtime entrypoint.
// Keep the shared Zoho Mail API transport stable and independent from app templates.
// The legacy SMTP bridge is not used in production because outbound SMTP can
// time out on hosted Railway workers. The active server uses the Zoho Mail API.
await import('./server.js');
