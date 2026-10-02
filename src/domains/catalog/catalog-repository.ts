import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { MCPServerPackageConfigSchema } from "../../shared/schemas";
import { BLOCK_REASON, isBlockedBy, loadHostingBlacklist } from "../../shared/utils/blocklist-util";
import { getDirname } from "../../shared/utils/file-util";
import { getNpxArgs, getUvxArgs } from "../../shared/utils/mcp-client-util";
import { formatZodIssues } from "../../shared/utils/response-util";
import type { CategoryConfig } from "../config/config-types";
import type { MCPServerPackageConfig, PackagesList } from "../package/package-types";
import { AgentFileSchema, ToolFileSchema } from "./catalog-schema";
import type {
  AgentDetail,
  AgentFile,
  AgentResolvedServer,
  AgentSummary,
  CatalogStats,
  CategoryInfo,
  EnvVar,
  FeaturedCatalog,
  IndexedDoc,
  ServerDetail,
  ServerSummary,
  ToolDetail,
  ToolFile,
  ToolInfo,
  ToolSummary,
} from "./catalog-types";

const __dirname = getDirname(import.meta.url);
export const ROOT_DIR = path.join(__dirname, "../../..");

/** Indexed for search and filters but never returned to clients. */
export const HIDDEN_DOC_FIELDS = ["text", "fNeedsKeys", "fRuntime", "fServers"] as const;

export interface CatalogFileError {
  /** Path relative to the repository root. */
  file: string;
  message: string;
}

export interface LoadedFiles<T> {
  items: T[];
  errors: CatalogFileError[];
  /** Not fatal: the file sits in a folder named differently from its category. */
  warnings: CatalogFileError[];
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return listJsonFiles(file);
      return entry.isFile() && entry.name.endsWith(".json") ? [file] : [];
    });
}

/**
 * Reads every JSON file under `dir` (recursively) with `schema`. Invalid files are skipped and
 * reported: bad JSON, schema errors, a key that differs from the file name, an unknown category,
 * or a key already used by an earlier file.
 */
export function loadCatalogFiles<T extends { key: string; category: string }>(
  dir: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  categoryKeys: ReadonlySet<string>,
  rootDir = ROOT_DIR,
): LoadedFiles<T> {
  const result: LoadedFiles<T> = { items: [], errors: [], warnings: [] };
  const seen = new Map<string, string>();

  for (const file of listJsonFiles(dir)) {
    const rel = path.relative(rootDir, file);
    const fail = (message: string) => result.errors.push({ file: rel, message });

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      fail(`invalid JSON: ${(error as Error).message}`);
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      fail(formatZodIssues(parsed.error));
      continue;
    }

    const item = parsed.data;
    const base = path.basename(file, ".json");
    if (item.key !== base) {
      fail(`key '${item.key}' must equal the file name '${base}'`);
      continue;
    }
    if (!categoryKeys.has(item.category)) {
      fail(`unknown category '${item.category}' (see config/categories.mjs)`);
      continue;
    }
    const other = seen.get(item.key);
    if (other) {
      fail(`duplicate key '${item.key}' (also in ${other})`);
      continue;
    }

    seen.set(item.key, rel);
    if (path.basename(path.dirname(file)) !== item.category) {
      result.warnings.push({
        file: rel,
        message: `folder name differs from category '${item.category}'`,
      });
    }
    result.items.push(item);
  }
  return result;
}

export interface CatalogInput {
  packagesList: PackagesList;
  /** Parsed package configs by registry key. Keys without a valid config are left out. */
  configs: Map<string, MCPServerPackageConfig>;
  categories: CategoryConfig[];
  featured: string[];
  blacklist: Set<string>;
  tools: ToolFile[];
  agents: AgentFile[];
  version: string;
  errors?: CatalogFileError[];
  warnings?: CatalogFileError[];
}

interface ServerEntry {
  summary: ServerSummary;
  config: MCPServerPackageConfig;
  /** Cached tools from packages-list.json. */
  tools: ToolInfo[];
}

const docId = (type: string, identity: string) =>
  `${type}-${createHash("sha1").update(identity).digest("hex").slice(0, 20)}`;

/** "@scope/some-server_x" → "scope some server x", so parts of package names are searchable. */
const keyWords = (key: string) =>
  key
    .split(/[@/\-_.]+/)
    .filter(Boolean)
    .join(" ");

const joinText = (parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");

const needsKeys = (env: Record<string, EnvVar>) =>
  Object.values(env).some((v) => v.required && v.default === undefined);

function authorOf(config: MCPServerPackageConfig): string | undefined {
  if (config.author) return config.author;
  const scope = config.packageName.match(/^@([^/]+)\//)?.[1];
  if (scope && scope !== "alphesdk-remote") return scope;
  return config.url?.match(/github\.com\/([^/?#]+)/)?.[1];
}

function stdioLaunch(config: MCPServerPackageConfig) {
  if (config.runtime === "node") return { command: "npx", args: getNpxArgs(config) };
  if (config.runtime === "python") return { command: "uvx", args: getUvxArgs(config) };
  return undefined;
}

const notInRegistry = (server: string) => `Server '${server}' is not in the registry`;
const blockedServer = (server: string) => `Server '${server}' is blocked (hosting blacklist)`;
const notCached = (tool: string, server: string) =>
  `Tool '${tool}' is not in the cached tool list of '${server}'`;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const runnableFirst = (
  a: { name: string; runnable: boolean },
  b: { name: string; runnable: boolean },
) => Number(b.runnable) - Number(a.runnable) || byName(a, b);

export const toToolSummary = (t: ToolDetail): ToolSummary => ({
  key: t.key,
  name: t.name,
  description: t.description,
  category: t.category,
  categoryName: t.categoryName,
  tags: t.tags,
  mcp: t.mcp,
  serverName: t.serverName,
  runnable: t.runnable,
});

export const toAgentSummary = (a: AgentDetail): AgentSummary => ({
  key: a.key,
  name: a.name,
  description: a.description,
  category: a.category,
  categoryName: a.categoryName,
  tags: a.tags,
  ...(a.author ? { author: a.author } : {}),
  servers: a.servers,
  runnable: a.runnable,
});

/**
 * Everything the catalog API and search serve, built once from the registry index, the package
 * configs, config/*.mjs, tools/ and agents/. Pure: no IO and no process spawns.
 */
export class Catalog {
  /** In packages-list.json order. */
  readonly servers: ServerSummary[] = [];
  /** Curated tools, by name. */
  readonly tools: ToolDetail[];
  /** By name. */
  readonly agents: AgentDetail[];
  readonly categories: CategoryInfo[];
  readonly featured: FeaturedCatalog;
  readonly stats: Omit<CatalogStats, "search">;
  /** Search documents of all three types. */
  readonly docs: IndexedDoc[] = [];
  readonly errors: CatalogFileError[];
  readonly warnings: CatalogFileError[];

  private readonly serverMap = new Map<string, ServerEntry>();
  private readonly toolMap: Map<string, ToolDetail>;
  private readonly agentMap: Map<string, AgentDetail>;

  constructor(input: CatalogInput) {
    this.errors = input.errors ?? [];
    this.warnings = input.warnings ?? [];
    const categoryNames = new Map(input.categories.map((c) => [c.key, c.name]));
    const categoryName = (key: string) => categoryNames.get(key) ?? key;
    const featured = new Set(input.featured);

    for (const [key, entry] of Object.entries(input.packagesList)) {
      const config = input.configs.get(key);
      if (!config) continue;
      const env = config.env ?? {};
      const category = entry.category || "uncategorized";
      const tools = Object.entries(entry.tools ?? {}).map(
        ([toolKey, tool]): ToolInfo => ({
          name: tool.name || toolKey,
          ...(tool.description ? { description: tool.description } : {}),
        }),
      );
      const author = authorOf(config);
      const summary: ServerSummary = {
        packageName: key,
        name: config.name || key,
        description: config.description || "",
        category,
        categoryName: categoryName(category),
        runtime: config.runtime,
        validated: entry.validated === true,
        blocked: isBlockedBy(input.blacklist, config, key),
        needsKeys: needsKeys(env),
        remote: !!config.remotes?.length,
        toolCount: tools.length,
        ...(config.logo ? { logo: config.logo } : {}),
        ...(author ? { author } : {}),
      };
      this.servers.push(summary);
      this.serverMap.set(key, { summary, config, tools });

      this.docs.push({
        id: docId("mcp", key),
        type: "mcp",
        name: summary.name,
        description: summary.description,
        category,
        categoryName: summary.categoryName,
        tags: [],
        validated: summary.validated,
        blocked: summary.blocked,
        popularity: summary.blocked
          ? 0
          : (summary.validated ? 10 : 0) +
            Math.min(tools.length * 2, 40) +
            (summary.description.length > 50 ? 5 : 0) +
            (featured.has(key) ? 15 : 0),
        packageName: key,
        runtime: config.runtime,
        toolCount: tools.length,
        envCount: Object.keys(env).length,
        needsKeys: summary.needsKeys,
        remote: summary.remote,
        ...(summary.logo ? { logo: summary.logo } : {}),
        ...(author ? { author } : {}),
        text: joinText([...tools.flatMap((t) => [t.name, t.description]), keyWords(key), author]),
        fNeedsKeys: summary.needsKeys,
        fRuntime: config.runtime,
        fServers: [key],
      });
    }

    this.tools = input.tools.map((file) => this.buildTool(file, categoryName)).sort(byName);
    this.toolMap = new Map(this.tools.map((t) => [t.key, t]));
    for (const tool of this.tools) {
      const server = tool.server;
      this.docs.push({
        id: docId("tool", `curated:${tool.key}`),
        type: "tool",
        name: tool.name,
        description: tool.description,
        category: tool.category,
        categoryName: tool.categoryName,
        tags: tool.tags,
        validated: server?.validated ?? false,
        blocked: server?.blocked ?? false,
        popularity: tool.runnable ? 60 + (server?.validated ? 10 : 0) : 0,
        server: tool.mcp.server,
        serverName: tool.serverName,
        toolName: tool.mcp.tool,
        curated: true,
        key: tool.key,
        text: joinText([
          tool.mcp.server,
          keyWords(tool.mcp.server),
          tool.serverName,
          tool.mcp.tool,
        ]),
        fNeedsKeys: server?.needsKeys ?? false,
        ...(server ? { fRuntime: server.runtime } : {}),
        fServers: [tool.mcp.server],
      });
    }

    this.agents = input.agents.map((file) => this.buildAgent(file, categoryName)).sort(byName);
    this.agentMap = new Map(this.agents.map((a) => [a.key, a]));
    for (const agent of this.agents) {
      const found = agent.resolvedServers.flatMap((s) => (s.summary ? [s.summary] : []));
      const runtimes = new Set(found.map((s) => s.runtime));
      const [runtime] = runtimes;
      this.docs.push({
        id: docId("agent", agent.key),
        type: "agent",
        name: agent.name,
        description: agent.description,
        category: agent.category,
        categoryName: agent.categoryName,
        tags: agent.tags,
        validated: found.length === agent.servers.length && found.every((s) => s.validated),
        blocked: found.some((s) => s.blocked),
        popularity: agent.runnable ? 80 : 10,
        key: agent.key,
        servers: agent.servers,
        runnable: agent.runnable,
        text: joinText([
          agent.systemPrompt,
          ...agent.starterPrompts,
          agent.author,
          ...agent.resolvedServers.flatMap((s) => [s.server, ...(s.tools ?? [])]),
        ]),
        fNeedsKeys: found.some((s) => s.needsKeys),
        ...(runtimes.size === 1 ? { fRuntime: runtime } : {}),
        fServers: agent.servers,
      });
    }

    // Every cached tool is searchable, except where a curated tool already covers it.
    const curated = new Set(this.tools.map((t) => `${t.mcp.server}\u0000${t.mcp.tool}`));
    for (const [key, { summary, tools }] of this.serverMap) {
      for (const tool of tools) {
        const identity = `${key}\u0000${tool.name}`;
        if (curated.has(identity)) continue;
        this.docs.push({
          id: docId("tool", identity),
          type: "tool",
          name: tool.name,
          description: tool.description ?? "",
          category: summary.category,
          categoryName: summary.categoryName,
          tags: [],
          validated: summary.validated,
          blocked: summary.blocked,
          popularity: summary.blocked
            ? 0
            : (summary.validated ? 5 : 1) + (featured.has(key) ? 5 : 0),
          server: key,
          serverName: summary.name,
          toolName: tool.name,
          curated: false,
          text: joinText([key, keyWords(key), summary.name]),
          fNeedsKeys: summary.needsKeys,
          fRuntime: summary.runtime,
          fServers: [key],
        });
      }
    }

    const counts = new Map<string, CategoryInfo["counts"]>();
    for (const doc of this.docs) {
      let count = counts.get(doc.category);
      if (!count) {
        count = { mcp: 0, tool: 0, agent: 0 };
        counts.set(doc.category, count);
      }
      count[doc.type]++;
    }
    this.categories = input.categories.map((c) => ({
      key: c.key,
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      counts: counts.get(c.key) ?? { mcp: 0, tool: 0, agent: 0 },
    }));

    this.featured = {
      servers: [...featured].flatMap((key) => {
        const summary = this.serverMap.get(key)?.summary;
        return summary && !summary.blocked ? [summary] : [];
      }),
      tools: [...this.tools].sort(runnableFirst).map(toToolSummary),
      agents: [...this.agents].sort(runnableFirst).map(toAgentSummary),
    };

    const byRuntime: Record<string, number> = {};
    for (const s of this.servers) byRuntime[s.runtime] = (byRuntime[s.runtime] ?? 0) + 1;
    this.stats = {
      servers: {
        total: this.servers.length,
        validated: this.servers.filter((s) => s.validated).length,
        blocked: this.servers.filter((s) => s.blocked).length,
        remote: this.servers.filter((s) => s.remote).length,
        needsKeys: this.servers.filter((s) => s.needsKeys).length,
        byRuntime,
      },
      tools: {
        total: this.docs.filter((d) => d.type === "tool").length,
        curated: this.tools.length,
      },
      agents: {
        total: this.agents.length,
        runnable: this.agents.filter((a) => a.runnable).length,
      },
      categories: input.categories.length,
      version: input.version,
    };
  }

  /** Server page data from the index: cached tools only, nothing is started. */
  server(key: string): ServerDetail | undefined {
    const entry = this.serverMap.get(key);
    if (!entry) return undefined;
    const { summary, config, tools } = entry;

    const connect: ServerDetail["connect"] = { gatewayPath: `/mcp/${key}` };
    const stdio = summary.blocked || summary.remote ? undefined : stdioLaunch(config);
    if (stdio) connect.stdio = stdio;
    if (config.remotes?.length) connect.remoteUrl = config.remotes[0].url;

    return {
      ...summary,
      config,
      ...(summary.blocked ? { blockReason: BLOCK_REASON } : {}),
      env: config.env ?? {},
      tools,
      oauth: !!config.remotes?.some((r) => r.auth),
      connect,
    };
  }

  tool(key: string): ToolDetail | undefined {
    return this.toolMap.get(key);
  }

  agent(key: string): AgentDetail | undefined {
    return this.agentMap.get(key);
  }

  private buildTool(file: ToolFile, categoryName: (key: string) => string): ToolDetail {
    const { server, tool } = file.mcp;
    const entry = this.serverMap.get(server);
    const issues: string[] = [];
    if (!entry) {
      issues.push(notInRegistry(server));
    } else {
      if (entry.summary.blocked) issues.push(blockedServer(server));
      if (entry.tools.length && !entry.tools.some((t) => t.name === tool)) {
        issues.push(notCached(tool, server));
      }
    }
    return {
      key: file.key,
      name: file.name,
      description: file.description,
      category: file.category,
      categoryName: categoryName(file.category),
      tags: file.tags,
      mcp: { server, tool },
      serverName: entry?.summary.name ?? server,
      runnable: !!entry && !entry.summary.blocked,
      server: entry?.summary ?? null,
      issues,
    };
  }

  private buildAgent(file: AgentFile, categoryName: (key: string) => string): AgentDetail {
    const issues: string[] = [];
    const resolvedServers = file.servers.map((ref): AgentResolvedServer => {
      const entry = this.serverMap.get(ref.server);
      const resolved: AgentResolvedServer = {
        server: ref.server,
        ...(ref.tools ? { tools: ref.tools } : {}),
        found: !!entry,
      };
      if (!entry) {
        issues.push(notInRegistry(ref.server));
        return resolved;
      }
      if (entry.summary.blocked) issues.push(blockedServer(ref.server));
      for (const tool of ref.tools ?? []) {
        if (entry.tools.length && !entry.tools.some((t) => t.name === tool)) {
          issues.push(notCached(tool, ref.server));
        }
      }
      resolved.summary = entry.summary;
      resolved.env = entry.config.env ?? {};
      return resolved;
    });

    return {
      key: file.key,
      name: file.name,
      description: file.description,
      category: file.category,
      categoryName: categoryName(file.category),
      tags: file.tags,
      ...(file.author ? { author: file.author } : {}),
      servers: file.servers.map((s) => s.server),
      runnable: resolvedServers.every((s) => s.found && !s.summary?.blocked),
      ...(file.model ? { model: file.model } : {}),
      systemPrompt: file.systemPrompt,
      starterPrompts: file.starterPrompts,
      maxSteps: file.maxSteps,
      resolvedServers,
      issues,
    };
  }
}

const importDefault = async <T>(file: string): Promise<T> =>
  (await import(`file://${file}`)).default as T;

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

/** Reads what the catalog is built from. config/*.mjs are ES modules: edits need a restart. */
export async function readCatalogInput(): Promise<CatalogInput> {
  const categories = await importDefault<CategoryConfig[]>(
    path.join(ROOT_DIR, "config/categories.mjs"),
  );
  const featured = await importDefault<string[]>(path.join(ROOT_DIR, "config/featured.mjs"));
  const blacklist = await loadHostingBlacklist();
  const packagesList = readJson<PackagesList>(path.join(ROOT_DIR, "indexes/packages-list.json"));
  const { version } = readJson<{ version: string }>(path.join(ROOT_DIR, "package.json"));

  const errors: CatalogFileError[] = [];
  const configs = new Map<string, MCPServerPackageConfig>();
  for (const [key, entry] of Object.entries(packagesList)) {
    const file = path.join("packages", entry.path);
    try {
      const parsed = MCPServerPackageConfigSchema.safeParse(readJson(path.join(ROOT_DIR, file)));
      if (parsed.success) configs.set(key, parsed.data);
      else errors.push({ file, message: formatZodIssues(parsed.error) });
    } catch (error) {
      errors.push({ file, message: (error as Error).message });
    }
  }

  const categoryKeys = new Set(categories.map((c) => c.key));
  const tools = loadCatalogFiles(path.join(ROOT_DIR, "tools"), ToolFileSchema, categoryKeys);
  const agents = loadCatalogFiles(path.join(ROOT_DIR, "agents"), AgentFileSchema, categoryKeys);

  return {
    packagesList,
    configs,
    categories,
    featured,
    blacklist,
    tools: tools.items,
    agents: agents.items,
    version,
    errors: [...errors, ...tools.errors, ...agents.errors],
    warnings: [...tools.warnings, ...agents.warnings],
  };
}

export async function loadCatalog(): Promise<Catalog> {
  const started = Date.now();
  const catalog = new Catalog(await readCatalogInput());
  for (const e of catalog.errors) console.warn(`[Catalog] Skipped ${e.file}: ${e.message}`);
  console.log(
    `[Catalog] ${catalog.servers.length} servers, ${catalog.tools.length} curated tools, ` +
      `${catalog.agents.length} agents, ${catalog.docs.length} search docs ` +
      `(${Date.now() - started}ms)`,
  );
  return catalog;
}

let current: Promise<Catalog> | null = null;

/** The catalog, loaded on first use. */
export function getCatalog(): Promise<Catalog> {
  current ??= loadCatalog().catch((error) => {
    current = null;
    throw error;
  });
  return current;
}

/** Loads everything again; on failure the previous catalog stays in place. */
export async function reloadCatalog(): Promise<Catalog> {
  const next = await loadCatalog();
  current = Promise.resolve(next);
  return next;
}
