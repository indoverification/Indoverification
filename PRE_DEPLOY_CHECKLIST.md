# Multi-app pre-deploy checklist

## Automated checks

- [ ] App registry validation
- [ ] Request/appId isolation validation
- [ ] Email branding/template isolation validation
- [ ] Multi-app regression validation
- [ ] Startup/config validation
- [ ] Database app isolation contract validation
- [ ] Runtime syntax/import validation

## Live checks required before merging to `main`

- [ ] Railway service starts successfully from `src/entry.js`
- [ ] Health endpoint responds successfully
- [ ] Indoone browser origin passes CORS/preflight
- [ ] Indomark browser origin passes CORS/preflight
- [ ] Unknown or mismatched app/origin is rejected
- [ ] Indoone signup OTP is delivered with Indoone branding
- [ ] Indoone OTP verification succeeds and stays app-scoped
- [ ] Indoone welcome email is delivered with Indoone branding
- [ ] Indomark existing signup/login OTP flow still works
- [ ] Cross-app challenge verification is rejected
- [ ] OTP expiry, resend cooldown, and attempt limits still work

## Merge gate

Do not merge this branch to `main` until the live checks above have been manually verified in Railway with the real configured mail/database services.
