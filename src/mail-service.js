import nodemailer from 'nodemailer';

// One sender identity shared by every application.
const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = 'indogroup@zohomail.in';
const SMTP_USER = String(process.env.SMTP_USER || SENDER_EMAIL).trim();
const SMTP_PASS = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_TIMEOUT_MS || 15000));

let transporter;

function normalizeRecipient(value) {
  const recipient = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(recipient)) {
    throw new Error('The recipient email address is invalid.');
  }
  return recipient;
}

function getTransporter() {
  if (!SMTP_PASS) throw new Error('SMTP_PASS is required for the shared Zoho mail service.');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  const mail = getTransporter();
  const result = await mail.sendMail({
    from: { name: SENDER_NAME, address: SENDER_EMAIL },
    to: recipient,
    subject: String(subject || '').trim(),
    html: String(html || ''),
  });
  console.log(`MAIL SEND ACCEPTED sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} messageId=${result.messageId || 'unknown'}`);
  return result;
}

// server-multi-app.js still has the historical Zoho API send boundary.
// Route only that mail boundary through this single shared transport so all
// apps get the exact same From identity without changing app templates.
export function installSharedMailTransport() {
  if (globalThis.__indoSharedMailTransportInstalled) return true;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return false;

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    const url = String(rawUrl);
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

    if (method === 'POST' && /\/api\/accounts\/[^/]+\/messages(?:\?|$)/.test(url)) {
      let payload = {};
      try {
        payload = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      } catch {
        return new Response(JSON.stringify({ status: { code: 400, description: 'Invalid mail payload.' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        await sendMail({ to: payload.toAddress, subject: payload.subject, html: payload.content });
        return new Response(JSON.stringify({ status: { code: 200, description: 'success' }, data: { provider: 'zoho-smtp' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`MAIL SEND FAILED sender=${SENDER_NAME} <${SENDER_EMAIL}>: ${message}`);
        return new Response(JSON.stringify({ status: { code: 550, description: message } }), {
          status: 550,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return originalFetch(input, init);
  };

  globalThis.__indoSharedMailTransportInstalled = true;
  console.log(`Shared mail service ready: ${SENDER_NAME} <${SENDER_EMAIL}>`);
  return true;
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
