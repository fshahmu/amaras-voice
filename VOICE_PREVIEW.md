# Amara Voice test Preview

Only deploy this branch with `npx wrangler preview`. Do not merge or deploy production without approval.

The original portrait bytes and CSS are preserved. Static assets and `/session` now share the protected Preview origin. The production portrait website is unchanged.

## Configuration
The test Preview declares its own rate limiter and non-secret Cloudflare Access audience/team configuration. `OPENAI_API_KEY` must exist as a secret on this Preview. Production secrets are not inherited automatically. Keep its value out of source, browser code, chat, and logs.

The Access application must cover the Preview hostname and allow the intended signed-in user. Authentication and per-user rate limiting run before creating a paid session. `/api/voice-status` checks readiness and authentication without creating a paid session.

## Validation
Run `npm test` for signed-JWT backend tests and mocked browser lifecycle tests. Run `npm run build` for a non-deploying asset and Worker bundle check.

Open the Preview, sign in, and tap Start live conversation. Allow the microphone and speak. Test playback, mute/unmute, Stop, End, and leaving the page. A successful build or mocked test is not proof of live audio. If setup is incomplete, configure the secret in this Preview through the Cloudflare dashboard; do not paste it into chat.

A local headless visual render could not run in this execution environment. Portrait SHA-256: bc010424156a3d12e7fe8d71d7b7cb9f0386d69d9a94f3ce61c851b26d823b40. CSS matches the recovered release candidate exactly.
