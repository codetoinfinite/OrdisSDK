import { errorMessage, isAbort } from "./format";
import type {
  AgentChatRequest,
  AgentDetail,
  AgentEvent,
  AgentSummary,
  CatalogStats,
  CategoryInfo,
  Envelope,
  FeaturedCatalog,
  SearchParams,
  SearchResult,
  ServerDetail,
  Suggestion,
  ToolDetail,
  ToolInfo,
  ToolRunResult,
  ToolSummary,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "Can't reach the AlpheSDK API. Is `pnpm dev` running?";

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(OFFLINE);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch (err) {
    if (isAbort(err)) throw err;
    // The Vite proxy answers 5xx with an empty body when the API is down.
    throw new ApiError(res.status >= 500 ? OFFLINE : `Request failed (${res.status})`, res.status);
  }
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.message || `Request failed (${res.status})`, body?.code ?? res.status);
  }
  return body.data as T;
}

function postJson(body: unknown, signal?: AbortSignal, accept = "application/json"): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(body),
    signal,
  };
}

type QueryValue = string | number | boolean | string[] | undefined | null;

export function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(","));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* Short-lived cache for catalog lists that every window asks for. Failed requests are not kept. */
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
const CACHE_MS = 60_000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export const getStats = () => cached("stats", () => request<CatalogStats>("/api/v1/catalog/stats"));

export const getCategories = () =>
  cached("categories", () => request<CategoryInfo[]>("/api/v1/catalog/categories"));

export const getFeatured = () =>
  cached("featured", () => request<FeaturedCatalog>("/api/v1/catalog/featured"));

export const listAgents = () =>
  cached("agents", () => request<AgentSummary[]>("/api/v1/catalog/agents"));

export const listTools = () =>
  cached("tools", () => request<ToolSummary[]>("/api/v1/catalog/tools"));

export const getServer = (packageName: string, signal?: AbortSignal) =>
  request<ServerDetail>(`/api/v1/catalog/server${qs({ packageName })}`, { signal });

/** One server of a batch: its detail, or why it couldn't load. */
export interface ServerLoad {
  pkg: string;
  detail?: ServerDetail;
  error?: Error;
}

/** Loads several servers at once; one failure doesn't fail the rest. */
export const getServers = (packageNames: string[], signal?: AbortSignal) =>
  Promise.all(
    packageNames.map((pkg) =>
      getServer(pkg, signal).then(
        (detail): ServerLoad => ({ pkg, detail }),
        (error: unknown): ServerLoad => {
          if (isAbort(error)) throw error;
          return { pkg, error: error instanceof Error ? error : new Error(errorMessage(error)) };
        },
      ),
    ),
  );

export const getAgent = (key: string, signal?: AbortSignal) =>
  request<AgentDetail>(`/api/v1/catalog/agent${qs({ key })}`, { signal });

export const getTool = (key: string, signal?: AbortSignal) =>
  request<ToolDetail>(`/api/v1/catalog/tool${qs({ key })}`, { signal });

export function search(params: SearchParams, signal?: AbortSignal): Promise<SearchResult> {
  const { facets, ...rest } = params;
  return request<SearchResult>(`/api/v1/search${qs({ ...rest, facets })}`, { signal });
}

export async function suggest(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const data = await request<{ suggestions: Suggestion[] }>(`/api/v1/search/suggest${qs({ q })}`, {
    signal,
  });
  return data.suggestions;
}

/** Starts the server and lists its tools with input schemas. */
export const liveTools = (packageName: string, signal?: AbortSignal) =>
  request<ToolInfo[]>(`/api/v1/packages/tools${qs({ packageName })}`, { signal });

export interface RunToolBody {
  packageName: string;
  toolKey: string;
  inputData: Record<string, unknown>;
  envs?: Record<string, string>;
}

export const runTool = (body: RunToolBody, signal?: AbortSignal) =>
  request<ToolRunResult>("/api/v1/packages/run", postJson(body, signal));

/** Streams agent events (server-sent events over a POST response). */
export async function agentChat(
  body: AgentChatRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send("/api/v1/agents/chat", postJson(body, signal, "text/event-stream"));
  const type = res.headers.get("content-type") ?? "";
  if (!res.body || !type.includes("text/event-stream")) {
    let message = `Request failed (${res.status})`;
    try {
      const env = (await res.json()) as Envelope<unknown>;
      if (env.message) message = env.message;
    } catch {
      if (res.status >= 500) message = OFFLINE;
    }
    throw new ApiError(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseBlock(block);
      if (event) onEvent(event);
    }
    if (done) break;
  }
  const last = parseBlock(buffer);
  if (last) onEvent(last);
}

function parseBlock(block: string): AgentEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) } as AgentEvent;
  } catch {
    return null;
  }
}
