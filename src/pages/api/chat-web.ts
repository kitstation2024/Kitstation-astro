import type { APIRoute } from "astro";
import { consumeRateLimit } from "../../lib/rate-limit";
import { getServerEnv } from "../../lib/server-env";

export const prerender = false;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_HISTORY_MESSAGES = 10;
const CHAT_LIMIT = { limit: 30, windowSeconds: 600 };

const SYSTEM_PROMPT = `
Eres el asistente comercial de Kitstation.
Tu objetivo es informar, orientar y vender servicios de páginas web.

Reglas:
- Responde siempre en español.
- Sé breve, clara y útil.
- Explica beneficios, tiempos, tipos de webs y siguientes pasos.
- Si detectas intención de compra, invita a hablar por WhatsApp o dejar sus datos.
- No inventes precios exactos si no fueron dados.
- Si preguntan por tipo de web, sugiere opciones como tienda online, servicios, restaurante, blog, portafolio o agenda de citas.
- Mantén un tono comercial, amable y directo.
`;

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function getApiKey() {
  return getServerEnv("OPENAI_API_KEY");
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function sanitizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is ChatMessage =>
        !!item &&
        typeof item === "object" &&
        (item as ChatMessage).role !== undefined &&
        (item as ChatMessage).content !== undefined
    )
    .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const rate = await consumeRateLimit({ namespace: "chat", identifier: getClientIp(request), ...CHAT_LIMIT });
    if (rate.unavailable) return jsonResponse(503, { success: false, message: rate.unavailableReason === "configuration" ? "El rate limiter persistente no está configurado." : "El rate limiter persistente no está disponible." });
    if (!rate.allowed) {
      return new Response(JSON.stringify({ success: false, message: "Demasiados mensajes. Inténtalo más tarde." }), {
        status: 429,
        headers: { ...JSON_HEADERS, "Retry-After": String(rate.retryAfterSeconds) }
      });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return jsonResponse(500, {
        success: false,
        message: "Falta configurar OPENAI_API_KEY en el servidor."
      });
    }

    const body = await request.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const history = sanitizeHistory(body?.history);

    if (!message || message.length > 700) {
      return jsonResponse(400, {
        success: false,
        message: "Debes enviar un mensaje de hasta 700 caracteres."
      });
    }

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 220,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message }
        ]
      })
    });

    const result = await response.json().catch(() => null);
    const reply = result?.choices?.[0]?.message?.content;

    if (!response.ok || typeof reply !== "string" || !reply.trim()) {
      console.error("OpenAI chat error", result);
      return jsonResponse(502, {
        success: false,
        message: "No se pudo obtener respuesta del asistente."
      });
    }

    return jsonResponse(200, {
      success: true,
      reply: reply.trim(),
      model: MODEL
    });
  } catch (error) {
    console.error("Chat API error", error);
    return jsonResponse(500, {
      success: false,
      message: "Ocurrió un error procesando el chat."
    });
  }
};

export const OPTIONS: APIRoute = async () =>
  new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      Allow: "POST, OPTIONS"
    }
  });
