# Multi-app OTP architecture

This branch adds an additive isolation layer for multiple client apps while preserving the current OTP contract.

## Goals

- Keep app-specific branding, templates, assets, and configuration isolated.
- Keep OTP/challenge logic shared and stable.
- Keep existing Indomark endpoints backward compatible.
- Make future app onboarding a data/files-only operation whenever the existing auth flow is reused.
- Prevent one app's config or content from being selected for another app.

## Current branch safety

`main` is not modified by this branch. The branch starts from the current `main` commit and is intended for review before deployment.

## App identity

Every request should resolve a registered `appId` before selecting app-specific configuration.

Unknown app IDs must be rejected. The app identity must not be inferred from untrusted template names or URLs.

## App isolation

Each app owns its own folder under `src/apps/<appId>/` for configuration, branding, templates, and assets.

OTP challenges should carry `appId` as part of their server-side record so the same email can be active in multiple apps without cross-app ambiguity.

## Backward compatibility

The existing Indomark API contract remains the compatibility baseline. New app-aware behavior should be additive. Existing Indomark callers that do not send an app ID must continue to resolve to the legacy Indomark app identity until the production client is migrated.

## Future onboarding

For a standard email-OTP app, onboarding should require a new app folder and registration data only. Shared OTP code should not be copied per app.
