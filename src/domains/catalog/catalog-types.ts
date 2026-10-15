// Backend copy of the API contract in web/src/lib/types.ts (docs/ALPHESDK-PLAN.md §6).
// Keep both files in sync: field names and optionality must match exactly.
import type { z } from "zod";
import type { MCPServerPackageConfig } from "../package/package-types";
import type { AnyAgentFileSchema, ToolFileSchema } from "./catalog-schema";

export type ItemType = "mcp" | "tool" | "agent";
export type Runtime = MCPServerPackageConfig["runtime"];
export type SearchEngine = "meilisearch" | "memory";

export type EnvVar = NonNullable<MCPServerPackageConfig["env"]>[string];

export interface ToolInfo {
  name: string;
  description?: string;
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
  needsKeys: boolean;
  remote: boolean;
  toolCount: number;
  logo?: string;
  author?: string;
}

export interface ServerDetail extends ServerSummary {
  config: MCPServerPackageConfig;
  blockReason?: string;
  env: Record<string, EnvVar>;
  tools: ToolInfo[];
  oauth: boolean;
  connect: {
    gatewayPath: string;
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
  /** runnable counts chat agents; external ones are documented, not run here. */
  agents: { total: number; runnable: number; external: number; official: number };
  categories: number;
  version: string;
  search: { engine: SearchEngine };
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
  server: ServerSummary | null;
  issues: string[];
}

export interface AgentServerRef {
  server: string;
  tools?: string[];
}

export type AgentKind = "chat" | "external";

export interface ExternalRequirement {
  name: string;
  kind: "api-key" | "runtime" | "service" | "hardware" | "account";
  required: boolean;
  description?: string;
}

/** An agent that lives in its own repository: documented here, run from its source. */
export interface ExternalAgentInfo {
  repo: string;
  subpath?: string;
  homepage?: string;
  docs?: string;
  publisher: string;
  publisherType: "company" | "community" | "individual";
  whatItDoes: string;
  howItWorks: string;
  requirements: ExternalRequirement[];
  install: string[];
  run: string[];
  interfaces: string[];
  language?: string;
  framework?: string;
  models?: string;
  mcp: "client" | "server" | "both" | "none";
  github?: { stars: number; license?: string; pushedAt: string; checkedAt: string };
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
  /** Chat agents: every server is available. External agents: always false. */
  runnable: boolean;
  kind: AgentKind;
  /** External agents: published by the organisation that owns the product. */
  official?: boolean;
  stars?: number;
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
  external?: ExternalAgentInfo;
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
  kind: AgentKind;
  official?: boolean;
  stars?: number;
}

export type SearchDoc = McpDoc | ToolDoc | AgentDoc;

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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatRequest {
  agentKey?: string;
  servers?: AgentServerRef[];
  messages: ChatMessage[];
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

/** Parsed tools/<category>/<key>.json */
export type ToolFile = z.infer<typeof ToolFileSchema>;
/** Parsed agents/<category>/<key>.json */
export type AgentFile = z.infer<typeof AnyAgentFileSchema>;

/**
 * Search document as stored in the index: the contract doc plus fields that are searchable or
 * filterable but never returned (see HIDDEN_DOC_FIELDS).
 */
export type IndexedDoc = SearchDoc & {
  /** Extra searchable text: tool names, package words, author, prompts. */
  text: string;
  /** Effective filters across types: a tool inherits its server's, an agent its servers'. */
  fNeedsKeys: boolean;
  fRuntime?: Runtime;
  fServers: string[];
};
