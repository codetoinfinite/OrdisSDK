import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfig, canRunLocally, isApiKeyValid, presentedApiKey } from "../security";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("presentedApiKey", () => {
  const from = (headers: Record<string, string>) => presentedApiKey((name) => headers[name]);

  it("reads a bearer token or x-api-key", () => {
    expect(from({ authorization: `Bearer ${KEY}` })).toBe(KEY);
    expect(from({ authorization: `bearer  ${KEY}` })).toBe(KEY);
    expect(from({ "x-api-key": KEY })).toBe(KEY);
  });

  it("ignores other schemes and empty values", () => {
    expect(from({ authorization: `Basic ${KEY}` })).toBeUndefined();
    expect(from({ "x-api-key": "  " })).toBeUndefined();
    expect(from({})).toBeUndefined();
  });
});

describe("isApiKeyValid", () => {
  it("allows everything when no keys are set", () => {
    vi.stubEnv("ALPHE_SDK_API_KEYS", "");
    expect(isApiKeyValid(undefined)).toBe(true);
  });

  it("accepts any configured key and nothing else", () => {
    vi.stubEnv("ALPHE_SDK_API_KEYS", ` ${KEY} , ${OTHER} `);
    expect(isApiKeyValid(KEY)).toBe(true);
    expect(isApiKeyValid(OTHER)).toBe(true);
    expect(isApiKeyValid(undefined)).toBe(false);
    expect(isApiKeyValid(KEY.slice(1))).toBe(false);
    expect(isApiKeyValid(`${KEY},${OTHER}`)).toBe(false);
  });
});

describe("canRunLocally", () => {
  it("is allowed outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(canRunLocally()).toBe(true);
  });

  it("needs ALLOW_LOCAL_EXECUTION=true in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_EXECUTION", "");
    expect(canRunLocally()).toBe(false);
    vi.stubEnv("ALLOW_LOCAL_EXECUTION", "true");
    expect(canRunLocally()).toBe(true);
  });
});

describe("assertProductionConfig", () => {
  const production = (env: Record<string, string>) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_EXECUTION", "");
    vi.stubEnv("MCP_SANDBOX_PROVIDER", "SANDOCK");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  };

  it("does nothing outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALPHE_SDK_API_KEYS", "");
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("refuses to start without keys, or with short ones", () => {
    production({ ALPHE_SDK_API_KEYS: "" });
    expect(() => assertProductionConfig()).toThrow(/ALPHE_SDK_API_KEYS is not set/);
    production({ ALPHE_SDK_API_KEYS: `${KEY},short` });
    expect(() => assertProductionConfig()).toThrow(/at least 32 characters/);
  });

  it("refuses LOCAL execution unless allowed", () => {
    production({ ALPHE_SDK_API_KEYS: KEY, MCP_SANDBOX_PROVIDER: "LOCAL" });
    expect(() => assertProductionConfig()).toThrow(/MCP_SANDBOX_PROVIDER is LOCAL/);
    vi.stubEnv("ALLOW_LOCAL_EXECUTION", "true");
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("starts with keys and a sandbox", () => {
    production({ ALPHE_SDK_API_KEYS: KEY });
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
