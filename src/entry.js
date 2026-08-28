// Runtime entrypoint for Railway.
// Keep email/auth logic in one server implementation so outgoing messages
// are not rewritten by a second fetch layer.
import './server.js';
