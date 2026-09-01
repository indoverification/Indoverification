// One shared Zoho SMTP transport for every application.
// App-specific branding/templates are supplied by the caller; this service owns
// only the global sender identity and Zoho delivery credentials.

import nodemailer from 'nodemailer';

const SENDER_NAME = 'Indoverification';
const SENDER_EMAIL = 'indogroup@zohomail.in';
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.zoho.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || SENDER_EMAIL).trim();
const SMTP_PASSWORD = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
const SMTP_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.SMTP_TIMEOUT_MS || process.env.MAIL_API_TIMEOUT_MS || 30000),
);

let transporter;

function normalizeRecipient(value) {
  const recipient = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(recipient)) {
    throw new Error('The recipient email address is invalid.');
  }
  return recipient;
}

function assertConfigured() {
  const missing = [];
  if (!SMTP_USER) missing.push('SMTP_USER');
  if (!SMTP_PASSWORD) missing.push('SMTP_PASS');
  if (!SMTP_HOST) missing.push('SMTP_HOST');
  if (!SMTP_PORT) missing.push('SMTP_PORT');
  if (missing.length) throw new Error(`Zoho SMTP is not configured. Missing: ${missing.join(', ')}.`);
}

function getTransporter() {
  assertConfigured();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      requireTLS: SMTP_PORT === 587,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      tls: {
        servername: SMTP_HOST,
      },
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html }) {
  const recipient = normalizeRecipient(to);
  const mail = getTransporter();

  const result = await mail.sendMail({
    from: {
      name: SENDER_NAME,
      address: SENDER_EMAIL,
    },
    to: recipient,
    subject: String(subject || '').trim(),
    html: String(html || ''),
  });

  console.log(
    `MAIL SEND ACCEPTED provider=zoho-smtp sender=${SENDER_NAME} <${SENDER_EMAIL}> recipient=${recipient} messageId=${result.messageId}`,
  );
  return result;
}

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
