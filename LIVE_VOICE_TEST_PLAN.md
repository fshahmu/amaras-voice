# Amara live voice integration — test branch

This branch is a staging area. It does **not** deploy or replace the existing portrait website.

## Confirmed
- Existing static portrait website is hosted separately at `morning-morning-e46b.khb8dzmv5v.workers.dev`.
- Voice backend is in `src/Index.js` and only issues Realtime client secrets on an authenticated `POST /session`.
- The OpenAI API key must remain a Cloudflare Worker secret.

## Integration plan
1. Recover the existing static HTML, CSS, JavaScript, and portrait asset before modifying the design.
2. Add a Start Conversation control that requests microphone permission only after a user tap.
3. Authenticate to the backend **without** placing `SESSION_ACCESS_TOKEN` or `OPENAI_API_KEY` in browser code. The existing bearer token check cannot be safely used from a public static website. Use verified Cloudflare Access identity (JWT validated server-side), or an equivalent authenticated server-side session, with rate limiting.
4. On a valid authenticated `POST /session`, obtain a short-lived OpenAI Realtime client secret.
5. Establish a WebRTC audio session using the temporary client secret, route microphone input and model audio output, and support Stop/Mute.
6. Keep portrait animation independent of the audio connection until lip sync is implemented.
7. Test on iPhone Safari and only then request explicit deployment approval.

## Security gates
- No long-lived keys or shared secret tokens in browser source, GitHub, logs, or screenshots.
- Never assume the HTTP Origin header proves user identity.
- Protect paid session creation with authentication and rate limiting.
- No automatic deployment from this test branch.
