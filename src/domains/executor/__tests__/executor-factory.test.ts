import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutorFactory } from "../executor-factory";
import { LocalExecutor } from "../local-executor";
import { SandboxExecutor } from "../sandbox-executor";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ExecutorFactory.create", () => {
  it("won't let a request run on this host when a sandbox is configured", () => {
    vi.stubEnv("MCP_SANDBOX_PROVIDER", "SANDOCK");
    expect(ExecutorFactory.create("LOCAL")).toBeInstanceOf(SandboxExecutor);
  });

  it("lets a request pick another sandbox", () => {
    vi.stubEnv("MCP_SANDBOX_PROVIDER", "LOCAL");
    expect(ExecutorFactory.create("E2B")).toBeInstanceOf(SandboxExecutor);
    expect(ExecutorFactory.create()).toBeInstanceOf(LocalExecutor);
  });
});
