import { createHash, timingSafeEqual } from "node:crypto";
import { getSandboxProvider } from "./environment";

/** Shortest API key accepted in production: 32 characters, e.g. `openssl rand -hex 32` gives 64. */
const MIN_KEY_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

const isProduction = () => process.env.NODE_ENV === "production";

function rawApiKeys(): string[] {
  return (process.env.ALPHE_SDK_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * The key a request presents, from `Authorization: Bearer <key>` or `x-api-key: <key>`.
 * `header` looks a header up by its lower-case name.
 */
export function presentedApiKey(header: (name: string) => string | null | undefined) {
  const bearer = header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer ?? header("x-api-key") ?? "").trim() || undefined;
}

/**
 * Whether a presented key matches one of ALPHE_SDK_API_KEYS (comma-separated, so a key can be
 * rotated by adding the new one before removing the old). Comparing SHA-256 digests keeps every
 * comparison the same length, so timingSafeEqual applies and timing says nothing about the key.
 *
 * With no keys configured, every request is allowed. That is for local development only:
 * {@link assertProductionConfig} refuses to start a production server without keys.
 */
export function isApiKeyValid(presented: string | undefined): boolean {
  const keys = rawApiKeys();
  if (keys.length === 0) return true;
  if (!presented) return false;
  const given = digest(presented);
  let ok = false;
  for (const key of keys) ok = timingSafeEqual(digest(key), given) || ok;
  return ok;
}

/**
 * Whether this process may start MCP servers on its own host (npx, uvx, docker, go) instead of in
 * a sandbox. A server started here runs as the same user as the API, so it can read this
 * process's environment, secrets included. Allowed by default in development; in production only
 * when ALLOW_LOCAL_EXECUTION=true says the host is disposable and holds nothing worth stealing.
 */
export function canRunLocally(): boolean {
  return !isProduction() || process.env.ALLOW_LOCAL_EXECUTION === "true";
}

/** Stops a production start whose configuration would leave it open. Called once at startup. */
export function assertProductionConfig() {
  if (!isProduction()) return;

  const problems: string[] = [];
  const keys = rawApiKeys();
  if (keys.length === 0) {
    problems.push("ALPHE_SDK_API_KEYS is not set, so anyone could run MCP servers here");
  } else if (keys.some((key) => key.length < MIN_KEY_LENGTH)) {
    problems.push(`every key in ALPHE_SDK_API_KEYS must be at least ${MIN_KEY_LENGTH} characters`);
  }
  if (getSandboxProvider() === "LOCAL" && !canRunLocally()) {
    problems.push(
      "MCP_SANDBOX_PROVIDER is LOCAL; set a sandbox provider, or ALLOW_LOCAL_EXECUTION=true to " +
        "run servers on this host",
    );
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
  }
}
