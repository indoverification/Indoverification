// Railway runtime entrypoint.
// The compatibility server.js normalizes deployment environment values and
// starts the isolated multi-app runtime. The legacy server-v2.js is retained
// separately for rollback/comparison and is not the active entrypoint.
await import('./server.js');
