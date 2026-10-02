import type { MCPServerPackageConfig } from "../../package/package-types";
import type { CatalogInput } from "../catalog-repository";

const config = (
  packageName: string,
  extra: Partial<MCPServerPackageConfig> = {},
): MCPServerPackageConfig => ({ type: "mcp-server", runtime: "node", packageName, ...extra });

/**
 * A small registry: srv-math (validated, featured), srv-blocked (blacklisted), srv-remote (python,
 * remote, needs a key) and srv-broken (no config, left out). Curated tools and agents cover the
 * runnable, unknown-server, blocked-server and unknown-tool cases.
 */
export function catalogInput(overrides: Partial<CatalogInput> = {}): CatalogInput {
  return {
    packagesList: {
      "srv-math": {
        category: "dev",
        path: "dev/srv-math.json",
        validated: true,
        tools: {
          add: { name: "add", description: "Add two numbers" },
          echo: { name: "echo", description: "Echo text back" },
        },
      },
      "srv-blocked": { category: "dev", path: "dev/srv-blocked.json", tools: { add: {} } },
      "srv-remote": { category: "other", path: "other/srv-remote.json" },
      "srv-broken": { category: "dev", path: "dev/srv-broken.json" },
    },
    configs: new Map([
      [
        "srv-math",
        config("@acme/srv-math", {
          name: "Math Server",
          description: "Adds and echoes numbers for the catalog tests and demos",
          env: { LOG_LEVEL: { description: "Log level", required: false } },
        }),
      ],
      ["srv-blocked", config("srv-blocked", { name: "Blocked Server" })],
      [
        "srv-remote",
        config("srv-remote", {
          runtime: "python",
          name: "Remote Server",
          env: { TOKEN: { description: "API token", required: true } },
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        }),
      ],
    ]),
    categories: [
      { key: "dev", name: "Developer Tools", description: "Tools for developers" },
      { key: "other", name: "Other" },
    ],
    featured: ["srv-blocked", "srv-math", "srv-missing"],
    blacklist: new Set(["srv-blocked"]),
    tools: [
      {
        type: "tool",
        key: "add-numbers",
        name: "Add numbers",
        description: "Adds two numbers",
        category: "dev",
        tags: ["math"],
        mcp: { server: "srv-math", tool: "add" },
      },
      {
        type: "tool",
        key: "blocked-add",
        name: "Blocked add",
        description: "Adds on a blocked server",
        category: "dev",
        tags: [],
        mcp: { server: "srv-blocked", tool: "add" },
      },
      {
        type: "tool",
        key: "ghost",
        name: "Ghost",
        description: "Points at a server that does not exist",
        category: "other",
        tags: [],
        mcp: { server: "srv-nope", tool: "x" },
      },
      {
        type: "tool",
        key: "divide",
        name: "Divide",
        description: "A tool the server does not list",
        category: "dev",
        tags: [],
        mcp: { server: "srv-math", tool: "divide" },
      },
    ],
    agents: [
      {
        type: "agent",
        key: "math-helper",
        name: "Math helper",
        description: "Does sums",
        category: "dev",
        tags: ["math"],
        author: "Tests",
        systemPrompt: "Add numbers with the tools.",
        servers: [{ server: "srv-math", tools: ["add"] }],
        starterPrompts: ["Add 2 and 3"],
        maxSteps: 3,
      },
      {
        type: "agent",
        key: "broken-agent",
        name: "Broken agent",
        description: "Uses servers that cannot run",
        category: "other",
        tags: [],
        systemPrompt: "Never runs.",
        servers: [{ server: "srv-nope" }, { server: "srv-blocked" }],
        starterPrompts: [],
        maxSteps: 6,
      },
    ],
    version: "9.9.9",
    ...overrides,
  };
}
