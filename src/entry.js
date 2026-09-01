// Railway runtime entrypoint for the shared multi-app backend.
// The server imports the single shared mail service directly.
await import('./server.js');
