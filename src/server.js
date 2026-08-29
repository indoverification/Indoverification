// Compatibility entrypoint. The production OTP service implementation lives in server-v2.js.
// Normalize Railway's ZOHO_FROM value so quoted or display-name forms become a plain mailbox.
const rawZohoFrom = String(process.env.ZOHO_FROM || '').normalize('NFKC').trim();
const angleMatch = rawZohoFrom.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/i);
const plainMatch = rawZohoFrom.match(/^["']?\s*([^<>\s]+@[^<>\s]+)\s*["']?$/i);
if (angleMatch?.[1]) process.env.ZOHO_FROM = angleMatch[1].trim().toLowerCase();
else if (plainMatch?.[1]) process.env.ZOHO_FROM = plainMatch[1].trim().toLowerCase();

await import('./server-v2.js');
