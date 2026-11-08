// Amara voice backend and protected test frontend.
// Cloudflare Access must protect this Worker before enabling paid sessions.
// Access JWT verification below is defense in depth, not a replacement for Access policy.
const json = (message, status, headers = {}) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }
  });

function base64urlToBytes(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(b64 + "=".repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}

async function verifyAccessJWT(token, teamDomain, audience) {
  if (!token || !teamDomain || !audience) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1])));
    const domain = new URL("https://" + teamDomain).hostname;
    if (domain !== teamDomain || header.alg !== "RS256" || !header.kid) return false;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== `https://${teamDomain}` ||
        !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
        (claims.nbf !== undefined && claims.nbf > now)) return false;
    const keysResponse = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!keysResponse.ok) return false;
    const { keys } = await keysResponse.json();
    const jwk = keys?.find(k => k.kid === header.kid && k.kty === "RSA" &&
      (!k.alg || k.alg === "RS256") && (!k.use || k.use === "sig"));
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
      base64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return valid && typeof claims.sub === "string" && claims.sub ? claims.sub : false;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("Amara voice service is ready.");
    const isStatus = url.pathname === "/api/voice-status";
    if (url.pathname !== "/session" && !isStatus) {
      return env.ASSETS ? env.ASSETS.fetch(request) : json("Not found", 404);
    }
    const origin = request.headers.get("Origin");
    const allowed = origin === url.origin || (!!env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) ||
      (isStatus && request.method === "GET" && !origin);
    const cors = allowed && origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    } : {};
    if (!allowed) return json("Forbidden", 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== (isStatus ? "GET" : "POST")) return json("Method not allowed", 405, cors);
    if (!env.OPENAI_API_KEY || !env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN || !env.AMARA_RATE_LIMITER)
      return json("Service not configured", 503, cors);
    // Only accept Access's trusted edge-injected assertion, never a browser-supplied bearer secret.
    const identity = await verifyAccessJWT(
      request.headers.get("Cf-Access-Jwt-Assertion"),
      env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
    if (!identity) return json("Unauthorized", 401, cors);
    if (isStatus) return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store", ...cors } });
    // Rate limit before any paid OpenAI session is created.
    try {
      const limiter = await env.AMARA_RATE_LIMITER.limit({ key: identity });
      if (!limiter.success) return json("Too many sessions", 429, cors);
    } catch { return json("Session protection unavailable", 503, cors); }
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            type: "realtime",
            model: "gpt-realtime",
            audio: { output: { voice: "shimmer" } },
            max_output_tokens: 512,
            instructions: "You are Amara, a warm, thoughtful AI voice companion. Speak naturally, gently and conversationally. Keep answers concise unless asked to elaborate."
          }
        })
      });
      if (!response.ok) return json("Unable to start voice session", 502, cors);
      const credential = await response.json();
      if (typeof credential.value !== "string" || !credential.value) return json("Invalid voice credential", 502, cors);
      return new Response(JSON.stringify({ client_secret: { value: credential.value } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }
      });
    } catch { return json("Voice service unavailable", 502, cors); }
  }
};

