# IndoVerification authentication baseline

Canonical flow:

Login: Firebase email/password -> request login OTP -> receive challengeId -> verify OTP with the same challengeId -> send Welcome email -> return login success.

Signup: request signup OTP -> receive challengeId -> verify with the same challengeId -> frontend creates the Firebase account -> profile sync.

Rules:
- Never bypass OTP.
- Never use hard-coded/test OTPs in production code.
- Never keep a second OTP implementation or email rewrite layer.
- OTP records are challenge-based and expire.
- Zoho Mail is the single email transport.
- `indomark@zohomail.in` is the intended sender/support mailbox and must also be configured as a verified Zoho sender in the deployment environment.
- Future changes must build on the current main branch and must not roll back to older commits.
