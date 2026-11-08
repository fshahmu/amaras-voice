const enc = new TextEncoder();
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}
function parsePart(part) { return JSON.parse(new TextDecoder().decode(decodeBase64Url(part))); }
async function verifyAccess(token, env) {
  if (!token || !env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) return null;
  const domain = env.CF_ACCESS_TEAM_DOMAIN;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = parsePart(parts[0]);
    const payload = parsePart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== `https://${domain}` ||
        !(Array.isArray(payload.aud) ? payload.aud.includes(env.CF_ACCESS_AUD) : payload.aud === env.CF_ACCESS_AUD) ||
        typeof payload.exp !== "number" || payload.exp <= now ||
        typeof payload.nbf === "number" && payload.nbf > now ||
        typeof payload.iat !== "number" || payload.iat > now + 60 ||
        typeof payload.sub !== "string" || !payload.sub) return null;
    const keysResponse = await fetch(`https://${domain}/cdn-cgi/access/certs`);
    if (!keysResponse.ok) return null;
    const keys = await keysResponse.json();
    const jwk = keys.keys?.find(k => k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256"));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    return verified ? payload.sub : null;
  } catch { return null; }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("Amara voice service is ready.");
    if (url.pathname !== "/session") return new Response("Not found", { status: 404 });
    const origin = request.headers.get("Origin");
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
    if (!env.OPENAI_API_KEY || !env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN || !env.AMARA_RATE_LIMITER)
      return new Response("Service not configured", { status: 503, headers });
    const subject = await verifyAccess(request.headers.get("Cf-Access-Jwt-Assertion"), env);
    if (!subject) return new Response("Unauthorized", { status: 401, headers });
    try {
      const limited = await env.AMARA_RATE_LIMITER.limit({ key: subject });
      if (!limited.success) return new Response("Too many requests", { status: 429, headers });
      const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session: {
          type: "realtime", model: "gpt-realtime",
          audio: { output: { voice: "shimmer" } },
          instructions: "You are Amara, a warm, thoughtful AI voice companion. Speak naturally and respond conversationally."
        } })
      });
      if (!response.ok) return new Response("Voice session unavailable", { status: 502, headers });
      return new Response(await response.text(), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    } catch { return new Response("Voice service unavailable", { status: 502, headers }); }
  }
};
