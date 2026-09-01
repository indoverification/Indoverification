# App onboarding contract

For a standard email-OTP client, onboarding should be additive and isolated.

Create a new `src/apps/<appId>/` directory containing the app configuration and its email/branding manifest. Do not copy or fork the OTP engine.

The shared service resolves the registered app identity before selecting app-specific content. Unknown app IDs must be rejected.

Removing one app must remove only that app's registration/configuration/content. Shared OTP and other app registrations must remain unchanged.

This contract does not yet change the production server wiring; the current PR keeps the existing runtime behavior intact until the wiring is separately tested.
