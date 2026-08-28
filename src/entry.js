// Runtime entrypoint for Railway.
// Keep authentication/OTP logic in server.js. Normalize only the welcome-email
// rendering here so OTP delivery stays untouched.
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  if (url.includes('/api/accounts/') && url.endsWith('/messages') && typeof init.body === 'string') {
    try {
      const payload = JSON.parse(init.body);
      if (payload?.subject && /^Welcome to /i.test(String(payload.subject))) {
        const subject = String(payload.subject);
        const appName = subject.replace(/^Welcome to\s*/i, '').replace(/!\s*🎉?\s*$/, '').trim() || 'Indomark';
        payload.content = `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#18212f"><div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><div style="background:#0b1020;padding:24px;text-align:center;color:#fff;font-size:28px;font-weight:800">⚡ ${appName}</div><div style="padding:30px"><h1 style="margin:0 0 14px;color:#14213d">Welcome to ${appName}! 🎉</h1><p style="font-size:16px;line-height:1.7;color:#334155">Your login was verified successfully. Your account is ready to use.</p><div style="margin:24px 0;padding:18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;color:#14532d"><strong>You're all set.</strong><br>Open ${appName} to continue.</div><div style="text-align:center;margin:26px 0"><a href="https://indomark.github.io/Indomark/" style="display:inline-block;background:#16a36d;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:800">Open ${appName}</a></div><p style="font-size:13px;line-height:1.6;color:#64748b">Need help? Contact support at <a href="mailto:indomark@zohomail.in" style="color:#16865b;font-weight:700;text-decoration:none">indomark@zohomail.in</a></p></div><div style="background:#0b1020;color:#94a3b8;padding:16px;text-align:center;font-size:12px">Automated email from ${appName}.</div></div></body></html>`;
        payload.mailFormat = 'html';
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch (error) {
      console.error('Welcome email rendering failed:', error instanceof Error ? error.message : error);
    }
  }
  return originalFetch(input, init);
};

await import('./server.js');
