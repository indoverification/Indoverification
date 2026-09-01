// Compatibility entrypoint for the multi-app runtime.
// The legacy server-v2.js remains preserved for rollback/comparison.
const rawZohoFrom = String(process.env.ZOHO_FROM || '').normalize('NFKC').trim();
const angleMatch = rawZohoFrom.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/i);
const plainMatch = rawZohoFrom.match(/^["']?\s*([^<>\s]+@[^<>\s]+)\s*["']?$/i);
if (angleMatch?.[1]) process.env.ZOHO_FROM = angleMatch[1].trim().toLowerCase();
else if (plainMatch?.[1]) process.env.ZOHO_FROM = plainMatch[1].trim().toLowerCase();

await import('./server-multi-app.js');
