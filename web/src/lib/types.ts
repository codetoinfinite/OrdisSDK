// API contract between the web app and the registry API (docs/ALPHESDK-PLAN.md §6).
// The backend (src/domains/catalog, search, agent) returns exactly these shapes.
//
// `packageName` is always the registry key from indexes/packages-list.json (config.key when set,
// otherwise config.packageName). Every endpoint that takes `packageName` expects that key.

export type ItemType = "mcp" | "tool" | "agent";
export type Runtime = "node" | "python" | "java" | "go" | "docker";
export type SearchEngine = "meilisearch" | "memory";

export interface Envelope<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

export interface EnvVar {
  description: string;
  required: boolean;
  default?: string;
  secret?: boolean;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  title?: string;
  [key: string]: unknown;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

/** A package config as stored in packages/<category>/<file>.json. */
export interface ServerConfig {
  type: "mcp-server";
  runtime: Runtime;
  packageName: string;
  packageVersion?: string;
  bin?: string;
  binArgs?: string[];
  withPackages?: string[];
  remotes?: {
    type: "streamable-http";
    url: string;
    auth?: { type: "oauth2"; scopes?: string[] };
  }[];
  key?: string;
  name?: string;
  description?: string;
  readme?: string;
  url?: string;
  license?: string;
  logo?: string;
  author?: string;
  env?: Record<string, EnvVar>;
}

export interface ServerSummary {
  packageName: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  runtime: Runtime;
  validated: boolean;
  blocked: boolean;
  /** At least one env var is required and has no default. */
  needsKeys: boolean;
  /** Hosted remote server (config.remotes). */
  remote: boolean;
  toolCount: number;
  logo?: string;
  author?: string;
}

export interface ServerDetail extends ServerSummary {
  config: ServerConfig;
  blockReason?: string;
  env: Record<string, EnvVar>;
  /** Cached tool names and descriptions from the index (no inputSchema, no process spawn). */
  tools: ToolInfo[];
  /** Any remote declares OAuth 2.1 auth. */
  oauth: boolean;
  connect: {
    /** e.g. "/mcp/@modelcontextprotocol/server-everything" */
    gatewayPath: string;
    /** Direct stdio launch, when the runtime has a standard launcher (npx, uvx). */
    stdio?: { command: string; args: string[] };
    remoteUrl?: string;
  };
}

export interface CategoryInfo {
  key: string;
  name: string;
  description?: string;
  counts: { mcp: number; tool: number; agent: number };
}

export interface CatalogStats {
  servers: {
    total: number;
    validated: number;
    blocked: number;
    remote: number;
    needsKeys: number;
    byRuntime: Record<string, number>;
  };
  tools: { total: number; curated: number };
  agents: { total: number; runnable: number };
  categories: number;
  version: string;
  search: { engine: SearchEngine; documents: number };
}

export interface ToolSummary {
  key: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  mcp: { server: string; tool: string };
  serverName: string;
  runnable: boolean;
}

export interface ToolDetail extends ToolSummary {
  /** null when the referenced server does not exist. */
  server: ServerSummary | null;
  issues: string[];
}

export interface AgentServerRef {
  server: string;
  /** Optional allow-list of tool names. */
  tools?: string[];
}

export interface AgentSummary {
  key: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  author?: string;
  servers: string[];
  runnable: boolean;
}

export interface AgentResolvedServer extends AgentServerRef {
  found: boolean;
  summary?: ServerSummary;
  env?: Record<string, EnvVar>;
}

export interface AgentDetail extends AgentSummary {
  model?: string;
  systemPrompt: string;
  starterPrompts: string[];
  maxSteps: number;
  resolvedServers: AgentResolvedServer[];
  issues: string[];
}

export interface FeaturedCatalog {
  servers: ServerSummary[];
  tools: ToolSummary[];
  agents: AgentSummary[];
}

interface SearchDocBase {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  validated: boolean;
  blocked: boolean;
  popularity: number;
}

export interface McpDoc extends SearchDocBase {
  type: "mcp";
  packageName: string;
  runtime: Runtime;
  toolCount: number;
  envCount: number;
  needsKeys: boolean;
  remote: boolean;
  logo?: string;
  author?: string;
}

/** Curated tools (curated: true, key set) and every cached MCP tool (curated: false). */
export interface ToolDoc extends SearchDocBase {
  type: "tool";
  server: string;
  serverName: string;
  toolName: string;
  curated: boolean;
  key?: string;
}

export interface AgentDoc extends SearchDocBase {
  type: "agent";
  key: string;
  servers: string[];
  runnable: boolean;
}

export type SearchDoc = McpDoc | ToolDoc | AgentDoc;

/** `_formatted` holds `<mark>`-highlighted copies of name/description; treat as untrusted text. */
export type SearchHit = SearchDoc & { _formatted?: { name?: string; description?: string } };

export type SearchSort = "relevance" | "popularity:desc" | "name:asc";

export interface SearchParams {
  q?: string;
  type?: ItemType;
  category?: string;
  validated?: boolean;
  runtime?: Runtime;
  needsKeys?: boolean;
  /** Omitted: blocked items are included. false: hide blocked. */
  blocked?: boolean;
  server?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
  /** Facet names, e.g. ["type", "category", "runtime"]. */
  facets?: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  query: string;
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  facetDistribution?: Record<string, Record<string, number>>;
  engine: SearchEngine;
}

export interface Suggestion {
  id: string;
  type: ItemType;
  name: string;
  category: string;
  packageName?: string;
  server?: string;
  toolName?: string;
  key?: string;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string }
  | { type: string; [key: string]: unknown };

export interface ToolRunResult {
  content?: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatRequest {
  agentKey?: string;
  servers?: AgentServerRef[];
  messages: ChatMessage[];
  /** Keyed by packageName; sent only in the POST body. */
  envs?: Record<string, Record<string, string>>;
  model?: string;
}

export type AgentEvent =
  | { event: "status"; data: { message: string } }
  | { event: "tool_call"; data: { id: string; server: string; tool: string; args: unknown } }
  | { event: "tool_result"; data: { id: string; ok: boolean; ms: number; preview: string } }
  | { event: "message"; data: { content: string } }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { steps: number; model: string } };
