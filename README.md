# IndoVerification

Reusable email OTP authentication API.

## API endpoints
- POST /api/auth/signup/request-otp
- POST /api/auth/signup/verify-otp
- POST /api/auth/login/request-otp
- POST /api/auth/login/verify-otp
- POST /api/auth/resend-otp
- GET /health

## Setup
Use Node.js 20+. Run `npm install`, configure the variables shown in `.env.example`, then run `npm start`.

OTP codes are generated and verified on the server. SMTP credentials stay in environment variables and must never be committed to the repository.
