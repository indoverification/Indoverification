// Railway runtime entrypoint for the shared multi-app backend.
// Every app uses the same mail transport and sender identity. App-specific
// branding/templates remain inside server-multi-app.js.
await import('./server.js');
