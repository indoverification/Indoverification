# Railway final deployment checklist

## Before deploy

- Deploy `multi-app-architecture` branch, not `main`.
- Keep existing production secrets configured in Railway.
- Confirm `DATABASE_URL` points to the intended PostgreSQL instance.
- Confirm Zoho Mail OAuth environment variables are present.
- Confirm the service start command is `node src/entry.js` (or the package `start` script).

## After deploy

1. Check `/health`.
2. Open the Indoone web app and request a signup OTP.
3. Confirm the OTP email uses Indoone branding/template.
4. Verify the OTP and complete account creation.
5. Request a login OTP from Indoone and verify it.
6. Repeat a basic login/OTP test for the existing Indomark app.
7. Verify an Indoone challenge cannot be verified through an Indomark context, and vice versa.

## Merge gate

Do not merge this branch into `main` until the live checks above pass. The current PR remains the controlled merge point for the multi-app rollout.
