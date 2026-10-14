import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPServerPackageConfigSchema } from "../../schemas/common-schema";
import { getMcpClient } from "../mcp-client-util";

describe("getMcpClient", () => {
  it("says why a local server stopped while starting", async () => {
    // An installed server whose entry point is swapped for a script that fails like one would.
    const config = MCPServerPackageConfigSchema.parse({
      type: "mcp-server",
      name: "Crash test",
      runtime: "node",
      packageName: "@modelcontextprotocol/server-everything",
      bin: "-e",
      binArgs: ["console.error('Invalid API key for EXAMPLE_API_KEY'); process.exit(1)"],
    });

    await expect(getMcpClient(config)).rejects.toThrow(
      /Connection closed\nInvalid API key for EXAMPLE_API_KEY$/,
    );
  });

  it("won't start a server on this host in production unless allowed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_EXECUTION", "");
    const config = MCPServerPackageConfigSchema.parse({
      type: "mcp-server",
      name: "Everything",
      runtime: "node",
      packageName: "@modelcontextprotocol/server-everything",
    });
    try {
      await expect(getMcpClient(config)).rejects.toThrow(/disabled in production/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("on Vercel", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("refuses to spawn a local server", async () => {
      vi.stubEnv("VERCEL", "1");
      const config = MCPServerPackageConfigSchema.parse({
        type: "mcp-server",
        name: "Spawn test",
        runtime: "node",
        packageName: "@modelcontextprotocol/server-everything",
      });

      await expect(getMcpClient(config)).rejects.toThrow(/Vercel can't start local MCP servers/);
    });
  });
});
