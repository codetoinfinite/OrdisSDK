/**
 * Copy-paste configs for MCP clients. Every client talks to the AlpheSDK gateway
 * (`/mcp/<package>`), which reads keys from `x-mcp-env-<KEY>` headers, except
 * Claude Desktop in "stdio" mode, which launches the server directly.
 */
import { API_ORIGIN } from "./config";
import { isSecretKey } from "./format";
import type { Lang } from "./highlight";
import type { EnvVar } from "./types";

export type ClientId =
  | "claude-code"
  | "cursor"
  | "vscode"
  | "claude-desktop"
  | "rest"
  | "typescript";

export const CLIENTS: { id: ClientId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "rest", label: "REST" },
  { id: "typescript", label: "TypeScript" },
];

/** Clients that take several servers in one config (used by My stack). */
export const STACK_CLIENTS: ClientId[] = ["claude-code", "cursor", "vscode", "claude-desktop"];

export interface SnippetServer {
  /** Config entry name, unique within one snippet. */
  name: string;
  packageName: string;
  /** Absolute gateway URL. */
  url: string;
  env: Record<string, EnvVar>;
  /** Values the user saved for this package. */
  values: Record<string, string>;
  stdio?: { command: string; args: string[] };
  /** Example call for the REST snippet. */
  tool?: { name: string; input?: Record<string, unknown> };
}

export interface SnippetOptions {
  includeSecrets: boolean;
  desktopMode: "gateway" | "stdio";
}

export interface Snippet {
  lang: Lang;
  code: string;
  file?: string;
  note?: string;
}

interface KeyRef {
  name: string;
  description: string;
  secret: boolean;
  /** Written into the snippet as-is; undefined means "use a placeholder". */
  literal?: string;
}

/** Required keys plus optional keys the user filled in. Secrets stay placeholders unless opted in. */
function keysFor(server: SnippetServer, includeSecrets: boolean): KeyRef[] {
  const refs: KeyRef[] = [];
  for (const [name, spec] of Object.entries(server.env)) {
    const value = server.values[name]?.trim();
    if (!spec.required && !value) continue;
    const secret = isSecretKey(name, spec);
    let literal: string | undefined;
    if (value) literal = secret && !includeSecrets ? undefined : value;
    else if (spec.default) literal = spec.default;
    refs.push({ name, description: spec.description, secret, literal });
  }
  return refs;
}

export function gatewayUrl(gatewayPath: string): string {
  return API_ORIGIN + gatewayPath;
}

/** Wraps a value in single quotes for POSIX shells. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

function placeholderNote(
  servers: SnippetServer[],
  opts: SnippetOptions,
  how: string,
): string | undefined {
  const names = new Set<string>();
  for (const server of servers) {
    for (const key of keysFor(server, opts.includeSecrets))
      if (key.literal === undefined) names.add(key.name);
  }
  if (!names.size) return undefined;
  return `${how} ${[...names].join(", ")}.`;
}

function claudeCode(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const code = servers
    .map((server) => {
      const headers = keysFor(server, opts.includeSecrets).map((key) =>
        key.literal === undefined
          ? `--header "x-mcp-env-${key.name}: $${key.name}"`
          : `--header ${shq(`x-mcp-env-${key.name}: ${key.literal}`)}`,
      );
      return [`claude mcp add --transport http ${server.name} ${server.url}`, ...headers].join(
        " \\\n  ",
      );
    })
    .join("\n\n");
  return {
    lang: "bash",
    code,
    note: placeholderNote(servers, opts, "Export these in your shell first:"),
  };
}

function cursor(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const headers = Object.fromEntries(
      keysFor(server, opts.includeSecrets).map((key) => [
        `x-mcp-env-${key.name}`,
        key.literal ?? `\${env:${key.name}}`,
      ]),
    );
    mcpServers[server.name] = Object.keys(headers).length
      ? { url: server.url, headers }
      : { url: server.url };
  }
  return {
    lang: "json",
    code: json({ mcpServers }),
    file: ".cursor/mcp.json",
    note: placeholderNote(servers, opts, "Cursor reads these from your environment:"),
  };
}

function vscode(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const inputs = new Map<
    string,
    { type: "promptString"; id: string; description: string; password?: true }
  >();
  const entries: Record<string, unknown> = {};
  for (const server of servers) {
    const headers: Record<string, string> = {};
    for (const key of keysFor(server, opts.includeSecrets)) {
      if (key.literal !== undefined) {
        headers[`x-mcp-env-${key.name}`] = key.literal;
        continue;
      }
      headers[`x-mcp-env-${key.name}`] = `\${input:${key.name}}`;
      if (!inputs.has(key.name)) {
        inputs.set(key.name, {
          type: "promptString",
          id: key.name,
          description: key.description || key.name,
          ...(key.secret ? { password: true as const } : {}),
        });
      }
    }
    entries[server.name] = {
      type: "http",
      url: server.url,
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  const config = inputs.size
    ? { inputs: [...inputs.values()], servers: entries }
    : { servers: entries };
  return {
    lang: "json",
    code: json(config),
    file: ".vscode/mcp.json",
    note: inputs.size ? "VS Code asks for each input the first time the server starts." : undefined,
  };
}

function claudeDesktop(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const mcpServers: Record<string, unknown> = {};
  const direct = opts.desktopMode === "stdio";
  let fallback = false;
  for (const server of servers) {
    const keys = keysFor(server, opts.includeSecrets);
    const env = Object.fromEntries(keys.map((key) => [key.name, key.literal ?? `<${key.name}>`]));
    const hasEnv = keys.length > 0;
    if (direct && server.stdio) {
      mcpServers[server.name] = {
        command: server.stdio.command,
        args: server.stdio.args,
        ...(hasEnv ? { env } : {}),
      };
      continue;
    }
    if (direct) fallback = true;
    const args = ["-y", "mcp-remote", server.url];
    if (server.url.startsWith("http:")) args.push("--allow-http");
    for (const key of keys) args.push("--header", `x-mcp-env-${key.name}:\${${key.name}}`);
    mcpServers[server.name] = { command: "npx", args, ...(hasEnv ? { env } : {}) };
  }
  const notes = [
    placeholderNote(servers, opts, "Replace the <…> placeholders:"),
    fallback ? "Servers without a standard launcher use the gateway instead." : undefined,
    "Restart Claude Desktop after saving.",
  ].filter(Boolean);
  return {
    lang: "json",
    code: json({ mcpServers }),
    file: "claude_desktop_config.json",
    note: notes.join(" "),
  };
}

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "curl", version: "1.0.0" },
  },
});
const LIST_BODY = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });

function rest(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const blocks = servers.map((server) => {
    const keys = keysFor(server, opts.includeSecrets);
    const envs = Object.fromEntries(keys.map((key) => [key.name, key.literal ?? `<${key.name}>`]));
    const body = {
      packageName: server.packageName,
      toolKey: server.tool?.name ?? "<tool name>",
      inputData: server.tool?.input ?? {},
      ...(keys.length ? { envs } : {}),
    };
    const envHeaders = keys.map(
      (key) => `  -H ${shq(`x-mcp-env-${key.name}: ${key.literal ?? `<${key.name}>`}`)} \\`,
    );
    return [
      "# Run one tool (starts the server, calls the tool, returns the result)",
      `curl -s -X POST ${API_ORIGIN}/api/v1/packages/run \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d ${shq(JSON.stringify(body))}`,
      "",
      "# Or speak MCP to the gateway: initialize, then reuse the mcp-session-id response header",
      `curl -si -X POST ${server.url} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Accept: application/json, text/event-stream" \\`,
      ...envHeaders,
      `  -d ${shq(INIT_BODY)}`,
      "",
      `curl -s -X POST ${server.url} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Accept: application/json, text/event-stream" \\`,
      `  -H "mcp-session-id: <session id>" \\`,
      `  -d ${shq(LIST_BODY)}`,
    ].join("\n");
  });
  return {
    lang: "bash",
    code: blocks.join("\n\n"),
    note: placeholderNote(servers, opts, "Replace the <…> placeholders:"),
  };
}

function typescript(servers: SnippetServer[], opts: SnippetOptions): Snippet {
  const lines = [
    `import { Client } from "@modelcontextprotocol/sdk/client/index.js";`,
    `import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";`,
  ];
  servers.forEach((server, i) => {
    const suffix = servers.length > 1 ? String(i + 1) : "";
    const headers = keysFor(server, opts.includeSecrets).map(
      (key) =>
        `      "x-mcp-env-${key.name}": ${key.literal === undefined ? `process.env.${key.name} ?? ""` : JSON.stringify(key.literal)},`,
    );
    const init = headers.length
      ? [", {", "  requestInit: {", "    headers: {", ...headers, "    },", "  },", "}"].join("\n")
      : "";
    lines.push(
      "",
      `// ${server.packageName}`,
      `const transport${suffix} = new StreamableHTTPClientTransport(new URL(${JSON.stringify(server.url)})${init});`,
      `const client${suffix} = new Client({ name: "my-app", version: "1.0.0" });`,
      `await client${suffix}.connect(transport${suffix});`,
      `const { tools${suffix ? `: tools${suffix}` : ""} } = await client${suffix}.listTools();`,
    );
    if (server.tool) {
      lines.push(
        `const result${suffix} = await client${suffix}.callTool({ name: ${JSON.stringify(server.tool.name)}, arguments: ${JSON.stringify(server.tool.input ?? {})} });`,
      );
    }
  });
  return {
    lang: "ts",
    code: lines.join("\n"),
    note: "Needs @modelcontextprotocol/sdk (npm i @modelcontextprotocol/sdk).",
  };
}

const BUILDERS: Record<ClientId, (servers: SnippetServer[], opts: SnippetOptions) => Snippet> = {
  "claude-code": claudeCode,
  cursor,
  vscode,
  "claude-desktop": claudeDesktop,
  rest,
  typescript,
};

export function buildSnippet(
  client: ClientId,
  servers: SnippetServer[],
  opts: SnippetOptions,
): Snippet {
  if (!servers.length) return { lang: "text", code: "Add a server to generate a config." };
  return BUILDERS[client](servers, opts);
}

/* ---------- Agent chat ---------- */

export type AgentLang = "rest" | "typescript";

export interface AgentSnippetInput {
  agentKey: string;
  /** First user message. */
  message: string;
  /** Key names each server needs, by package. Always written as placeholders. */
  keys: Record<string, string[]>;
}

/** Calls `POST /api/v1/agents/chat`, which streams the reply back as server-sent events. */
export function agentSnippet(
  lang: AgentLang,
  { agentKey, message, keys }: AgentSnippetInput,
): Snippet {
  const url = `${API_ORIGIN}/api/v1/agents/chat`;
  const keyed = Object.entries(keys).filter(([, names]) => names.length);
  const messages = [{ role: "user", content: message }];

  if (lang === "rest") {
    const envs = Object.fromEntries(
      keyed.map(([pkg, names]) => [pkg, Object.fromEntries(names.map((n) => [n, `<${n}>`]))]),
    );
    const body = { agentKey, messages, ...(keyed.length ? { envs } : {}) };
    const names = [...new Set(keyed.flatMap(([, list]) => list))];
    return {
      lang: "bash",
      code: [
        "# Chat with the agent. The reply streams back as server-sent events:",
        "# status, tool_call, tool_result, message, error and done.",
        `curl -N -X POST ${url} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d ${shq(JSON.stringify(body))}`,
      ].join("\n"),
      note: names.length ? `Replace the <…> placeholders: ${names.join(", ")}.` : undefined,
    };
  }

  const envLines = keyed.length
    ? [
        "    envs: {",
        ...keyed.map(
          ([pkg, names]) =>
            `      ${JSON.stringify(pkg)}: { ${names.map((n) => `${n}: process.env.${n} ?? ""`).join(", ")} },`,
        ),
        "    },",
      ]
    : [];
  const code = [
    `const res = await fetch(${JSON.stringify(url)}, {`,
    `  method: "POST",`,
    `  headers: { "Content-Type": "application/json" },`,
    "  body: JSON.stringify({",
    `    agentKey: ${JSON.stringify(agentKey)},`,
    `    messages: [{ role: "user", content: ${JSON.stringify(message)} }],`,
    ...envLines,
    "  }),",
    "});",
    "// A bad request comes back as a JSON error instead of a stream.",
    `if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {`,
    "  throw new Error(await res.text());",
    "}",
    "",
    `// Each event is "event: <name>\\ndata: <json>" followed by a blank line.`,
    "const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();",
    `let buffer = "";`,
    "for (;;) {",
    "  const { value, done } = await reader.read();",
    "  if (done) break;",
    "  buffer += value;",
    `  const blocks = buffer.split("\\n\\n");`,
    `  buffer = blocks.pop() ?? "";`,
    "  for (const block of blocks) {",
    "    const event = block.match(/^event: (.*)$/m)?.[1];",
    "    const data = block.match(/^data: (.*)$/m)?.[1];",
    "    if (!event || !data) continue;",
    "    const payload = JSON.parse(data);",
    `    if (event === "tool_call") console.log(\`→ \${payload.tool}\`, payload.args);`,
    `    if (event === "message") console.log(payload.content);`,
    `    if (event === "error") throw new Error(payload.message);`,
    "  }",
    "}",
  ].join("\n");
  return {
    lang: "ts",
    code,
    note: `${keyed.length ? "Set the keys as environment variables first. " : ""}Runs as an ES module in Node 18+, Deno or Bun.`,
  };
}
