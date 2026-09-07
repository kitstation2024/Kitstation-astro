import type { APIRoute } from "astro";
import type { Transporter } from "nodemailer";
import { consumeRateLimit } from "../../lib/rate-limit";

export const prerender = false;

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const FORM_LIMIT = { limit: 5, windowSeconds: 600 };
const ALLOWED_HOSTNAMES = new Set(["kitstation.pe", "www.kitstation.pe"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const ALLOWED_FORMS = new Set([
  "Contacto", "Diseño de Página Web", "Automatización con IA", "Campañas Digitales", "Posicionamiento SEO",
  "Consultoría y Soporte", "Creación de Contenido", "Animación Digital", "Diagnóstico de Proyecto",
  "Suscripción al newsletter", "Libro de Reclamaciones"
]);

const ALLOWED_FIELDS = new Set([
  "formulario", "pagina_origen", "privacy", "website", "cf-turnstile-response", "name", "company", "email",
  "phone", "service", "need", "budget", "project_description", "message", "tipo_documento", "numero_documento",
  "nombres", "apellidos", "departamento", "provincia", "distrito", "direccion", "correo_electronico", "telefono",
  "padre_madre", "bien_contratado", "monto_reclamado", "descripcion", "pedido", "aviso_legal", "descripcion_monto",
  "descripcion_pedido", "description", "detalle_reclamo", "fecha_incidente", "fecha_pedido", "fecha_registro",
  "hora_registro", "nombre_completo", "producto", "reclamo_id", "tipo_envio", "tipo_reclamo", "correo_electrónico", "teléfono"
]);
const EXCLUDED_FIELDS = new Set(["formulario", "pagina_origen", "privacy", "website", "cf-turnstile-response"]);
const LONG_FIELDS = new Set(["message", "need", "project_description", "descripcion", "pedido", "detalle_reclamo", "descripcion_monto", "descripcion_pedido", "description"]);

function jsonResponse(status: number, payload: Record<string, unknown>, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function cleanValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getEnv(name: string) {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function getRecipients() {
  return getEnv("MAIL_TO").split(",").map((item) => item.trim()).filter(Boolean);
}

function getMissingEnvVars() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "TURNSTILE_SECRET_KEY"];
  return required.filter((name) => !getEnv(name));
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function getRequestMetadata(request: Request) {
  return { ip: getClientIp(request), userAgent: request.headers.get("user-agent") ?? "No disponible", referer: request.headers.get("referer") ?? "No disponible" };
}

function isAllowedHostname(hostname: unknown) {
  if (typeof hostname !== "string") return false;
  if (ALLOWED_HOSTNAMES.has(hostname)) return true;
  const isLocalDevelopment = getEnv("VERCEL_ENV") !== "production" && getEnv("NODE_ENV") !== "production";
  if (isLocalDevelopment && LOCAL_HOSTNAMES.has(hostname)) return true;
  return false;
}

async function verifyTurnstile(token: string, ip: string) {
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: getEnv("TURNSTILE_SECRET_KEY"), response: token });
  if (ip !== "unknown") body.set("remoteip", ip);

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000)
    });
    const result = (await response.json().catch(() => null)) as { success?: boolean; hostname?: unknown } | null;
    return response.ok && result?.success === true && isAllowedHostname(result.hostname);
  } catch {
    return false;
  }
}

function validateEntries(entries: Map<string, string>) {
  if (entries.size === 0 || entries.size > 45) return "Datos de formulario no válidos.";
  for (const [name, value] of entries) {
    if (!ALLOWED_FIELDS.has(name)) return "Datos de formulario no válidos.";
    const maxLength = LONG_FIELDS.has(name) ? 4000 : name === "cf-turnstile-response" ? 2048 : name === "pagina_origen" ? 2048 : 254;
    if (value.length > maxLength) return "Uno de los campos supera la longitud permitida.";
  }
  return null;
}

function fieldLabel(name: string) {
  const labels: Record<string, string> = { name: "Nombre", company: "Empresa", email: "Correo electrónico", phone: "Celular", service: "Servicio de interés", need: "Necesidad", budget: "Presupuesto aproximado", project_description: "Breve descripción del proyecto", message: "Mensaje", tipo_documento: "Tipo de documento", numero_documento: "Número de documento", nombres: "Nombres", apellidos: "Apellidos", departamento: "Departamento", provincia: "Provincia", distrito: "Distrito", direccion: "Dirección", correo_electronico: "Correo electrónico", telefono: "Teléfono", monto_reclamado: "Monto reclamado", descripcion: "Descripción", pedido: "Pedido" };
  return labels[name] ?? name.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function htmlValue(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replace(/\r?\n/g, "<br />");
}

function getSubmitterName(entries: Map<string, string>) {
  return entries.get("name") || entries.get("company") || entries.get("nombres") || entries.get("correo_electronico") || entries.get("email") || "cliente";
}

async function sendInternalMail(transporter: Transporter, entries: Map<string, string>, metadata: ReturnType<typeof getRequestMetadata>) {
  const formName = entries.get("formulario") ?? "Formulario";
  const details = [...entries.entries()].filter(([key]) => !EXCLUDED_FIELDS.has(key)).map(([key, value]) => `<tr><td style="padding:8px 12px;border:1px solid #d7deea;font-weight:700;">${htmlValue(fieldLabel(key))}</td><td style="padding:8px 12px;border:1px solid #d7deea;">${htmlValue(value || "No indicado")}</td></tr>`).join("");
  await transporter.sendMail({ from: getEnv("MAIL_FROM"), to: getRecipients(), replyTo: entries.get("email") || entries.get("correo_electronico") || undefined, subject: `Nuevo mensaje desde Kitstation: ${formName}`, html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;"><h2>Nuevo envío recibido</h2><table style="border-collapse:collapse;width:100%;max-width:760px;"><tbody>${details}</tbody></table><h3 style="margin-top:24px;">Datos de la solicitud</h3><ul><li><strong>Formulario:</strong> ${htmlValue(formName)}</li><li><strong>Página de origen:</strong> ${htmlValue(entries.get("pagina_origen") || metadata.referer)}</li><li><strong>IP:</strong> ${htmlValue(metadata.ip)}</li><li><strong>User-Agent:</strong> ${htmlValue(metadata.userAgent)}</li></ul></div>` });
}

async function sendAutoReply(transporter: Transporter, entries: Map<string, string>) {
  const recipient = entries.get("email") || entries.get("correo_electronico");
  if (!recipient) return;
  await transporter.sendMail({ from: getEnv("MAIL_FROM"), to: recipient, subject: "Gracias por escribirnos | Kitstation", html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;"><p>Hola ${htmlValue(getSubmitterName(entries))},</p><p>Gracias por escribirnos. Recibimos tu mensaje correctamente y nos pondremos en contacto contigo a la brevedad.</p><p>Equipo Kitstation</p></div>` });
}

async function handleSubmit(request: Request) {
  const metadata = getRequestMetadata(request);
  const rate = await consumeRateLimit({ namespace: "mail", identifier: metadata.ip, ...FORM_LIMIT });
  if (rate.unavailable) return jsonResponse(503, { success: false, message: "El servicio de seguridad no está disponible." });
  if (!rate.allowed) return jsonResponse(429, { success: false, message: "Demasiados intentos. Inténtalo más tarde." }, { "Retry-After": String(rate.retryAfterSeconds) });

  const missingEnv = getMissingEnvVars();
  if (missingEnv.length > 0 || getRecipients().length === 0) return jsonResponse(503, { success: false, message: "Configuración de seguridad o correo incompleta." });

  const formData = await request.formData();
  const honeypot = cleanValue(formData.get("website"));
  if (honeypot) return jsonResponse(400, { success: false, message: "Solicitud rechazada." });

  const entries = new Map<string, string>();
  for (const [key, value] of formData.entries()) entries.set(key, cleanValue(value));
  const entriesError = validateEntries(entries);
  if (entriesError) return jsonResponse(400, { success: false, message: entriesError });

  const token = entries.get("cf-turnstile-response") || "";
  if (!(await verifyTurnstile(token, metadata.ip))) return jsonResponse(400, { success: false, message: "No se pudo validar la verificación de seguridad." });

  const formName = entries.get("formulario") || "";
  if (!ALLOWED_FORMS.has(formName)) return jsonResponse(400, { success: false, message: "Formulario no válido." });
  const email = entries.get("email") || entries.get("correo_electronico") || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return jsonResponse(400, { success: false, message: "El correo electrónico no es válido." });

  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default ?? nodemailerModule;
  const transporter = nodemailer.createTransport({ host: getEnv("SMTP_HOST"), port: Number(getEnv("SMTP_PORT")), secure: Number(getEnv("SMTP_PORT")) === 465, auth: { user: getEnv("SMTP_USER"), pass: getEnv("SMTP_PASS") } });
  await sendInternalMail(transporter, entries, metadata);
  await sendAutoReply(transporter, entries);
  return jsonResponse(200, { success: true, message: "Mensaje enviado correctamente." });
}

export const POST: APIRoute = async ({ request }) => {
  try { return await handleSubmit(request); }
  catch { return jsonResponse(500, { success: false, message: "No se pudo enviar el formulario." }); }
};
export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: { ...JSON_HEADERS, Allow: "POST, OPTIONS" } });
export const GET: APIRoute = async () => jsonResponse(405, { success: false, message: "Método no permitido." });
