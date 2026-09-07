type RateLimitOptions = {
  namespace: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  persistent: boolean;
  unavailable?: boolean;
};

type MemoryEntry = { count: number; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();

function getEnv(name: string) {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function isProduction() {
  return import.meta.env.PROD;
}

function keyFor({ namespace, identifier }: RateLimitOptions) {
  return `kitstation:rate-limit:${namespace}:${encodeURIComponent(identifier || "unknown")}`;
}

async function upstashCommand(command: Array<string | number>) {
  const url = getEnv("UPSTASH_REDIS_REST_URL");
  const token = getEnv("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!response.ok || !payload || payload.error) {
    throw new Error("Persistent rate limit unavailable");
  }
  return payload.result;
}

function consumeMemory(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const key = keyFor(options);
  const current = memoryStore.get(key);
  const entry = !current || current.expiresAt <= now
    ? { count: 0, expiresAt: now + options.windowSeconds * 1000 }
    : current;

  entry.count += 1;
  memoryStore.set(key, entry);
  return {
    allowed: entry.count <= options.limit,
    remaining: Math.max(0, options.limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    persistent: false
  };
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const url = getEnv("UPSTASH_REDIS_REST_URL");
  const token = getEnv("UPSTASH_REDIS_REST_TOKEN");

  if (!url || !token) {
    if (isProduction()) {
      return { allowed: false, remaining: 0, retryAfterSeconds: options.windowSeconds, persistent: false, unavailable: true };
    }
    return consumeMemory(options);
  }

  try {
    const key = keyFor(options);
    await upstashCommand(["SET", key, "0", "EX", options.windowSeconds, "NX"]);
    const count = Number(await upstashCommand(["INCR", key]));
    if (!Number.isFinite(count)) throw new Error("Invalid persistent rate limit response");
    return {
      allowed: count <= options.limit,
      remaining: Math.max(0, options.limit - count),
      retryAfterSeconds: options.windowSeconds,
      persistent: true
    };
  } catch {
    return { allowed: false, remaining: 0, retryAfterSeconds: options.windowSeconds, persistent: true, unavailable: true };
  }
}
