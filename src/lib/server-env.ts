import { getSecret } from "astro:env/server";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Server-only runtime configuration. Never import this module from client code. */
export function getServerEnv(name: string) {
  return clean(getSecret(name)) || clean(process.env[name]) || clean(import.meta.env[name]);
}
