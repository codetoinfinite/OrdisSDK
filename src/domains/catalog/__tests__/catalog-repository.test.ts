import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BLOCK_REASON } from "../../../shared/utils/blocklist-util";
import { Catalog, HIDDEN_DOC_FIELDS, loadCatalogFiles } from "../catalog-repository";
import { ToolFileSchema } from "../catalog-schema";
import { catalogInput } from "./catalog-fixture";

describe("Catalog", () => {
  const catalog = new Catalog(catalogInput());

  it("leaves out registry keys without a valid config", () => {
    expect(catalog.servers.map((s) => s.packageName)).toEqual([
      "srv-math",
      "srv-blocked",
      "srv-remote",
    ]);
    expect(catalog.server("srv-broken")).toBeUndefined();
  });

  it("computes stats", () => {
    expect(catalog.stats).toEqual({
      servers: {
        total: 3,
        validated: 1,
        blocked: 1,
        remote: 1,
        needsKeys: 1,
        byRuntime: { node: 2, python: 1 },
      },
      // 4 curated + srv-math/echo; srv-math/add and srv-blocked/add are covered by curated tools
      tools: { total: 5, curated: 4 },
      agents: { total: 2, runnable: 1 },
      categories: 2,
      version: "9.9.9",
    });
  });

  it("builds server details with connect info", () => {
    const math = catalog.server("srv-math");
    expect(math).toMatchObject({
      name: "Math Server",
      category: "dev",
      categoryName: "Developer Tools",
      runtime: "node",
      validated: true,
      blocked: false,
      needsKeys: false,
      remote: false,
      toolCount: 2,
      author: "acme",
      oauth: false,
      tools: [
        { name: "add", description: "Add two numbers" },
        { name: "echo", description: "Echo text back" },
      ],
      connect: {
        gatewayPath: "/mcp/srv-math",
        stdio: { command: "npx", args: ["-y", "@acme/srv-math"] },
      },
    });
    expect(math?.blockReason).toBeUndefined();

    const remote = catalog.server("srv-remote");
    expect(remote?.needsKeys).toBe(true);
    expect(remote?.connect).toEqual({
      gatewayPath: "/mcp/srv-remote",
      remoteUrl: "https://example.com/mcp",
    });
  });

  it("marks blacklisted servers blocked, without a launch command", () => {
    const blocked = catalog.server("srv-blocked");
    expect(blocked?.blocked).toBe(true);
    expect(blocked?.blockReason).toBe(BLOCK_REASON);
    expect(blocked?.connect).toEqual({ gatewayPath: "/mcp/srv-blocked" });
  });

  it("resolves curated tools and reports issues", () => {
    expect(catalog.tools.map((t) => t.key)).toEqual([
      "add-numbers",
      "blocked-add",
      "divide",
      "ghost",
    ]);
    expect(catalog.tool("add-numbers")).toMatchObject({
      serverName: "Math Server",
      runnable: true,
      issues: [],
      server: { packageName: "srv-math" },
    });
    expect(catalog.tool("blocked-add")).toMatchObject({
      runnable: false,
      issues: ["Server 'srv-blocked' is blocked (hosting blacklist)"],
    });
    expect(catalog.tool("ghost")).toMatchObject({
      serverName: "srv-nope",
      runnable: false,
      server: null,
      issues: ["Server 'srv-nope' is not in the registry"],
    });
    expect(catalog.tool("divide")).toMatchObject({
      runnable: true,
      issues: ["Tool 'divide' is not in the cached tool list of 'srv-math'"],
    });
    expect(catalog.tool("nope")).toBeUndefined();
  });

  it("resolves agents and reports issues", () => {
    const helper = catalog.agent("math-helper");
    expect(helper).toMatchObject({
      servers: ["srv-math"],
      runnable: true,
      author: "Tests",
      maxSteps: 3,
      issues: [],
    });
    expect(helper?.resolvedServers).toEqual([
      {
        server: "srv-math",
        tools: ["add"],
        found: true,
        summary: catalog.servers[0],
        env: { LOG_LEVEL: { description: "Log level", required: false } },
      },
    ]);

    const broken = catalog.agent("broken-agent");
    expect(broken?.runnable).toBe(false);
    expect(broken?.issues).toEqual([
      "Server 'srv-nope' is not in the registry",
      "Server 'srv-blocked' is blocked (hosting blacklist)",
    ]);
    expect(broken?.resolvedServers[0]).toEqual({ server: "srv-nope", found: false });
  });

  it("features known, unblocked servers and lists runnable items first", () => {
    expect(catalog.featured.servers.map((s) => s.packageName)).toEqual(["srv-math"]);
    expect(catalog.featured.tools.map((t) => t.key)).toEqual([
      "add-numbers",
      "divide",
      "blocked-add",
      "ghost",
    ]);
    expect(catalog.featured.agents.map((a) => a.key)).toEqual(["math-helper", "broken-agent"]);
    expect(Object.keys(catalog.featured.tools[0])).not.toContain("issues");
  });

  it("counts every item type per category", () => {
    expect(catalog.categories).toEqual([
      {
        key: "dev",
        name: "Developer Tools",
        description: "Tools for developers",
        counts: { mcp: 2, tool: 4, agent: 1 },
      },
      { key: "other", name: "Other", counts: { mcp: 1, tool: 1, agent: 1 } },
    ]);
  });

  it("indexes each server, curated tool, uncovered cached tool and agent once", () => {
    const ids = catalog.docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tools = catalog.docs.filter((d) => d.type === "tool");
    expect(tools.map((d) => `${d.server}/${d.toolName}/${d.curated}`).sort()).toEqual([
      "srv-blocked/add/true",
      "srv-math/add/true",
      "srv-math/divide/true",
      "srv-math/echo/false",
      "srv-nope/x/true",
    ]);
    const blockedServer = catalog.docs.find(
      (d) => d.type === "mcp" && d.packageName === "srv-blocked",
    );
    expect(blockedServer).toMatchObject({ blocked: true, popularity: 0 });
    const agent = catalog.docs.find((d) => d.type === "agent" && d.key === "math-helper");
    expect(agent).toMatchObject({ fServers: ["srv-math"], fRuntime: "node", runnable: true });
    for (const field of HIDDEN_DOC_FIELDS) expect(agent).toHaveProperty(field);
  });
});

describe("loadCatalogFiles", () => {
  let root: string;

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write = (file: string, content: unknown) => {
    const full = path.join(root, "tools", file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  };
  const tool = (key: string, category: string) => ({
    type: "tool",
    key,
    name: key,
    description: `The ${key} tool`,
    category,
    mcp: { server: "srv-math", tool: "add" },
  });

  it("keeps valid files and reports every kind of problem", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "alphesdk-catalog-"));
    write("dev/bad-json.json", "{");
    write("dev/good.json", tool("good", "dev"));
    write("dev/mismatch.json", tool("other-name", "dev"));
    write("dev/schema.json", { type: "tool", key: "schema" });
    write("dev/unknown-category.json", tool("unknown-category", "nope"));
    write("other/good.json", tool("good", "other"));
    write("other/misplaced.json", tool("misplaced", "dev"));
    write("other/notes.txt", "ignored");

    const result = loadCatalogFiles(
      path.join(root, "tools"),
      ToolFileSchema,
      new Set(["dev", "other"]),
      root,
    );

    expect(result.items.map((t) => t.key)).toEqual(["good", "misplaced"]);
    expect(result.items[0].tags).toEqual([]);
    expect(result.errors.map((e) => e.file)).toEqual([
      "tools/dev/bad-json.json",
      "tools/dev/mismatch.json",
      "tools/dev/schema.json",
      "tools/dev/unknown-category.json",
      "tools/other/good.json",
    ]);
    const [badJson, mismatch, schema, unknownCategory, duplicate] = result.errors.map(
      (e) => e.message,
    );
    expect(badJson).toMatch(/^invalid JSON: /);
    expect(mismatch).toBe("key 'other-name' must equal the file name 'mismatch'");
    expect(schema).toContain("name: Required");
    expect(unknownCategory).toBe("unknown category 'nope' (see config/categories.mjs)");
    expect(duplicate).toBe("duplicate key 'good' (also in tools/dev/good.json)");
    expect(result.warnings).toEqual([
      { file: "tools/other/misplaced.json", message: "folder name differs from category 'dev'" },
    ]);
  });

  it("returns nothing for a missing folder", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "alphesdk-catalog-"));
    expect(loadCatalogFiles(path.join(root, "tools"), ToolFileSchema, new Set(), root)).toEqual({
      items: [],
      errors: [],
      warnings: [],
    });
  });
});
