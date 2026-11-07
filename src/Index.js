
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Amara voice service is ready.");
    }

    if (url.pathname !== "/session" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const origin = request.headers.get("Origin");

    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!env.OPENAI_API_KEY || !env.SESSION_ACCESS_TOKEN) {
      return new Response("Service not configured", { status: 503 });
    }

    const authorization = request.headers.get("Authorization");

    if (authorization !== `Bearer ${env.SESSION_ACCESS_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const response = await fetch(
        "https://api.openai.com/v1/realtime/client_secrets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            session: {
              type: "realtime",
              model: "gpt-realtime",
              audio: {
                output: {
                  voice: "shimmer"
                }
              },
              instructions:
                "You are Amara, a warm, thoughtful AI voice companion. Speak naturally and respond conversationally."
            }
          })
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": origin,
          "Vary": "Origin"
        }
      });
    } catch {
      return new Response("Voice service unavailable", {
        status: 502
      });
    }
  }
};
