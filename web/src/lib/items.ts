import { paths } from "../wm/routes";
import type {
  AgentSummary,
  ItemType,
  Runtime,
  SearchHit,
  ServerSummary,
  ToolSummary,
} from "./types";

/** A catalog entry (server, tool or agent) normalized for cards. */
export interface CardItem {
  type: ItemType;
  /** Unique within a list; used as the React key. */
  id: string;
  href: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  /** Identity in My stack; undefined for MCP tools that have no curated entry. */
  stackId?: string;
  validated?: boolean;
  blocked?: boolean;
  needsKeys?: boolean;
  remote?: boolean;
  runtime?: Runtime;
  toolCount?: number;
  /** Tools: the server that provides the tool. */
  serverName?: string;
  /** Agents: how many servers the agent uses. */
  serverCount?: number;
  runnable?: boolean;
  /** `<mark>`-highlighted copies from search; untrusted text. */
  highlight?: { name?: string; description?: string };
}

export function fromServer(s: ServerSummary): CardItem {
  return {
    type: "mcp",
    id: `mcp:${s.packageName}`,
    href: paths.server(s.packageName),
    name: s.name,
    description: s.description,
    category: s.category,
    categoryName: s.categoryName,
    stackId: s.packageName,
    validated: s.validated,
    blocked: s.blocked,
    needsKeys: s.needsKeys,
    remote: s.remote,
    runtime: s.runtime,
    toolCount: s.toolCount,
  };
}

export function fromTool(t: ToolSummary): CardItem {
  return {
    type: "tool",
    id: `tool:${t.key}`,
    href: paths.tool(t.key),
    name: t.name,
    description: t.description,
    category: t.category,
    categoryName: t.categoryName,
    stackId: t.key,
    serverName: t.serverName,
    runnable: t.runnable,
  };
}

export function fromAgent(a: AgentSummary): CardItem {
  return {
    type: "agent",
    id: `agent:${a.key}`,
    href: paths.agent(a.key),
    name: a.name,
    description: a.description,
    category: a.category,
    categoryName: a.categoryName,
    stackId: a.key,
    serverCount: a.servers.length,
    runnable: a.runnable,
  };
}

export function fromHit(hit: SearchHit): CardItem {
  const base = {
    id: hit.id,
    name: hit.name,
    description: hit.description,
    category: hit.category,
    categoryName: hit.categoryName,
    validated: hit.validated,
    blocked: hit.blocked,
    highlight: hit._formatted,
  };
  switch (hit.type) {
    case "mcp":
      return {
        ...base,
        type: "mcp",
        href: paths.server(hit.packageName),
        stackId: hit.packageName,
        needsKeys: hit.needsKeys,
        remote: hit.remote,
        runtime: hit.runtime,
        toolCount: hit.toolCount,
      };
    case "tool":
      return {
        ...base,
        type: "tool",
        href: hit.key
          ? paths.tool(hit.key)
          : paths.server(hit.server, { tab: "tools", tool: hit.toolName }),
        stackId: hit.key,
        serverName: hit.serverName,
      };
    case "agent":
      return {
        ...base,
        type: "agent",
        href: paths.agent(hit.key),
        stackId: hit.key,
        serverCount: hit.servers.length,
        runnable: hit.runnable,
      };
  }
}
