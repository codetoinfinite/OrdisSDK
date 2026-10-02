import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { isBlocked } from "../../shared/utils/blocklist-util";
import type { Catalog } from "../catalog/catalog-repository";
import type { AgentChatRequest, AgentEvent, AgentServerRef } from "../catalog/catalog-types";

// Agent chat: an OpenRouter model picks MCP tools and the registry runs them (port of
// demo/agent.mjs). Progress is reported as AgentEvents; the route streams them as SSE.

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
export const DEFAULT_MAX_STEPS = 6;
export const MAX_STEPS_CAP = 10;
/** Tool output the model sees, in characters. */
export const MODEL_RESULT_LIMIT = 20_000;
/** Tool output shown to the client, in characters. */
export const PREVIEW_LIMIT = 2_000;
export const NOT_CONFIGURED = "Agent chat is not configured on this server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_TIMEOUT_MS = 120_000;
const TOOL_NAME_MAX = 64;
const TRUNCATED = "… [truncated]";
const ADHOC_SYSTEM_PROMPT =
  "You are a helpful assistant with access to MCP tools. Use a tool when it helps answer the " +
  "user, then reply concisely with the result.";

export interface AgentDeps {
  /** OpenRouter API key; without one every chat ends with NOT_CONFIGURED. */
  apiKey?: string;
  /** OPENROUTER_MODEL */
  defaultModel?: string;
  getCatalog: () => Promise<Catalog>;
  listTools: (server: string) => Promise<Tool[]>;
  runTool: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
    envs?: Record<string, string>,
  ) => Promise<unknown>;
  fetch?: typeof fetch;
}

export type Emit = (event: AgentEvent) => unknown;

interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** An MCP tool as offered to the model. */
export interface ToolBinding {
  /** Function name the model calls: ^[a-zA-Z0-9_-]{1,64}$, unique per chat. */
  name: string;
  server: string;
  tool: string;
  definition: FunctionTool;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments?: unknown };
}

interface AssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: ToolCall[];
}

type ModelMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  | AssistantMessage;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Makes `raw` a valid function name that `taken` does not have yet. */
export function sanitizeToolName(raw: string, taken: { has(name: string): boolean }): string {
  const base = (raw.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool").slice(0, TOOL_NAME_MAX);
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, TOOL_NAME_MAX - suffix.length) + suffix;
  }
  return name;
}

/** Function tools for the model; names are prefixed per server (s0__echo) so they never clash. */
export function buildToolMap(
  servers: { server: string; serverName: string; tools: Tool[] }[],
): Map<string, ToolBinding> {
  const map = new Map<string, ToolBinding>();
  servers.forEach(({ server, serverName, tools }, i) => {
    for (const tool of tools) {
      const name = sanitizeToolName(`s${i}__${tool.name}`, map);
      map.set(name, {
        name,
        server,
        tool: tool.name,
        definition: {
          type: "function",
          function: {
            name,
            description: `[${serverName}] ${tool.description || tool.name}`,
            parameters: {
              ...tool.inputSchema,
              type: "object",
              properties: tool.inputSchema?.properties ?? {},
            },
          },
        },
      });
    }
  });
  return map;
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - TRUNCATED.length)) + TRUNCATED;
}

/** Text of an MCP tool result: text items verbatim, other content as a placeholder. */
export function toolResultText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) {
    return typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
  }
  const text = content
    .map(
      (item: {
        type?: string;
        text?: unknown;
        mimeType?: string;
        resource?: { text?: unknown };
      }) => {
        if (item?.type === "text" && typeof item.text === "string") return item.text;
        if (item?.type === "resource" && typeof item.resource?.text === "string") {
          return item.resource.text;
        }
        const mime = item?.mimeType ? ` (${item.mimeType})` : "";
        return `[${item?.type ?? "unknown"} content${mime} omitted]`;
      },
    )
    .join("\n");
  return text || "(no output)";
}

/** The agent's model, then the request's, then OPENROUTER_MODEL, then DEFAULT_MODEL. */
export const resolveModel = (agentModel?: string, requestModel?: string, envModel?: string) =>
  agentModel || requestModel || envModel || DEFAULT_MODEL;

function parseArgs(raw: unknown): Record<string, unknown> {
  const value = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : {}) : (raw ?? {});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("arguments must be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function callModel(
  deps: AgentDeps,
  body: { model: string; messages: ModelMessage[]; tools?: FunctionTool[] },
  signal: AbortSignal,
): Promise<AssistantMessage> {
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    });
  } catch (error) {
    if ((error as Error).name === "TimeoutError") {
      throw new Error(`Model request timed out after ${MODEL_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: { message?: AssistantMessage }[];
  } | null;
  if (!res.ok || !json || json.error) {
    throw new Error(
      `Model request failed (${res.status}): ${json?.error?.message ?? res.statusText}`,
    );
  }
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error("Model returned no message");
  return message;
}

/**
 * Runs one chat turn: loads the tools of the agent's (or the request's) servers, then lets the
 * model call them for up to maxSteps model calls. Always ends with a done event unless the client
 * went away (signal aborted). Blocked and unknown servers are refused before anything starts.
 */
export async function runAgentChat(
  request: AgentChatRequest,
  emit: Emit,
  deps: AgentDeps,
  signal: AbortSignal,
): Promise<void> {
  let model = resolveModel(undefined, request.model, deps.defaultModel);
  let steps = 0;
  const status = (message: string) => emit({ event: "status", data: { message } });

  try {
    if (!deps.apiKey) throw new Error(NOT_CONFIGURED);
    const catalog = await deps.getCatalog();

    let refs: AgentServerRef[];
    let systemPrompt = ADHOC_SYSTEM_PROMPT;
    let maxSteps = DEFAULT_MAX_STEPS;
    if (request.agentKey) {
      const agent = catalog.agent(request.agentKey);
      if (!agent) throw new Error(`Agent '${request.agentKey}' not found`);
      refs = agent.resolvedServers.map(({ server, tools }) => ({ server, tools }));
      systemPrompt = agent.systemPrompt;
      maxSteps = agent.maxSteps;
      model = resolveModel(agent.model, request.model, deps.defaultModel);
    } else if (request.servers?.length) {
      refs = request.servers;
    } else {
      throw new Error("Provide agentKey or servers");
    }
    maxSteps = Math.min(Math.max(maxSteps, 1), MAX_STEPS_CAP);

    const servers: { ref: AgentServerRef; name: string }[] = [];
    for (const ref of refs) {
      const server = catalog.server(ref.server);
      // Blacklisted keys are left out of the index, so check the blacklist before "not in the registry".
      if (server?.blocked || (await isBlocked({ packageName: ref.server }, ref.server))) {
        throw new Error(`Server '${ref.server}' is blocked (hosting blacklist)`);
      }
      if (!server) throw new Error(`Server '${ref.server}' is not in the registry`);
      servers.push({ ref, name: server.name });
    }

    const messages: ModelMessage[] = [{ role: "system", content: systemPrompt }];
    for (const { role, content } of request.messages) {
      if (content.trim()) messages.push({ role, content });
    }
    if (!messages.some((m) => m.role === "user")) throw new Error("Send a message first");

    await status(`Loading tools from ${servers.map((s) => s.name).join(", ")}`);
    const listed = await Promise.all(
      servers.map(async ({ ref, name }) => {
        const tools = await deps.listTools(ref.server).catch((error) => {
          throw new Error(`Could not list tools of '${ref.server}': ${errorMessage(error)}`);
        });
        const allowed = ref.tools;
        const missing = allowed?.filter((tool) => !tools.some((t) => t.name === tool)) ?? [];
        return {
          server: ref.server,
          serverName: name,
          tools: allowed ? tools.filter((t) => allowed.includes(t.name)) : tools,
          missing,
        };
      }),
    );
    if (signal.aborted) return;
    for (const { server, missing } of listed) {
      if (missing.length) await status(`'${server}' does not offer: ${missing.join(", ")}`);
    }
    const toolMap = buildToolMap(listed);
    const tools = [...toolMap.values()].map((binding) => binding.definition);
    await status(
      tools.length
        ? `${tools.length} tool(s) ready`
        : "No tools available; answering without tools",
    );

    while (steps < maxSteps) {
      steps++;
      const message = await callModel(
        deps,
        { model, messages, ...(tools.length ? { tools } : {}) },
        signal,
      );
      messages.push(message);
      if (typeof message.content === "string" && message.content.trim()) {
        await emit({ event: "message", data: { content: message.content } });
      }
      const calls = message.tool_calls ?? [];
      if (!calls.length) return;

      for (const call of calls) {
        if (signal.aborted) return;
        const binding = toolMap.get(call.function?.name);
        const started = Date.now();
        let args: Record<string, unknown> = {};
        let text: string;
        let ok = false;
        let argsError: string | undefined;
        try {
          args = parseArgs(call.function?.arguments);
        } catch (error) {
          argsError = `Invalid tool arguments: ${errorMessage(error)}`;
        }
        await emit({
          event: "tool_call",
          data: {
            id: call.id,
            server: binding?.server ?? "",
            tool: binding?.tool ?? String(call.function?.name),
            args: argsError ? call.function?.arguments : args,
          },
        });
        if (!binding) {
          text = `Unknown tool '${call.function?.name}'`;
        } else if (argsError) {
          text = argsError;
        } else {
          try {
            const result = await deps.runTool(
              binding.server,
              binding.tool,
              args,
              request.envs?.[binding.server],
            );
            text = toolResultText(result);
            ok = (result as { isError?: boolean } | null)?.isError !== true;
          } catch (error) {
            text = `Tool failed: ${errorMessage(error)}`;
          }
        }
        if (signal.aborted) return;
        await emit({
          event: "tool_result",
          data: {
            id: call.id,
            ok,
            ms: Date.now() - started,
            preview: truncate(text, PREVIEW_LIMIT),
          },
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: truncate(text, MODEL_RESULT_LIMIT),
        });
      }
    }
    await status(`Stopped after ${steps} steps (step limit)`);
  } catch (error) {
    if (signal.aborted) return;
    console.warn(`[Agent] Chat failed: ${errorMessage(error)}`);
    await emit({ event: "error", data: { message: errorMessage(error) } });
  } finally {
    if (!signal.aborted) await emit({ event: "done", data: { steps, model } });
  }
}
