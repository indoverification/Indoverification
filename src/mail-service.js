import nodemailer from 'nodemailer';

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

export const SHARED_SENDER = Object.freeze({ name: SENDER_NAME, email: SENDER_EMAIL });
