# Amara Voice — deployment review (test branch only)

## Current status

This branch is not approved for production deployment. The portrait website is separate and must remain unchanged.

## Cloudflare configuration to verify

- Worker name: `amaras-voice` (confirm it does not collide with a production Worker before any deploy).
- Root directory: repository root.
- Build command: `npm run check` for a dry-run validation only; do not configure a production deployment command on this branch.
- Wrangler configuration: `wrangler.jsonc`.
- Entry point: `src/Index.js` (case-sensitive).
- Required Worker secrets/config: `OPENAI_API_KEY`, `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`; never commit secret values.
- Required rate-limit binding: `AMARA_RATE_LIMITER`.
- Configure Cloudflare Access to restrict `/session` at the edge, in addition to verifying JWT in code.
- Keep the existing portrait Worker/site unchanged.

## Test procedure (after Cloudflare access is available)

1. Obtain the actual Cloudflare failed-build log and compare the error with the configuration above.
2. Run `npm install` and `npm run check` locally or in an isolated CI check. A dry run does not deploy.
3. Confirm missing Access configuration yields HTTP 503 and unauthenticated requests cannot create paid sessions.
4. Confirm valid authenticated requests are rate limited before OpenAI is contacted.
5. Test WebRTC microphone permissions, playback, Stop and Mute from iPhone Safari after the frontend is safely integrated.
6. Request explicit approval before any preview or production deployment or merging into `main`.

Do not treat a successful dry-run as a tested live voice application.
