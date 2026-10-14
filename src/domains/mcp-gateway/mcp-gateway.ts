import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BlockedPackageError, isBlocked } from "../../shared/utils/blocklist-util";
import { getPackageTools, runPackageTool } from "../package/package-handler";
import type { PackageRepository } from "../package/package-repository";
import type { MCPServerPackageConfig } from "../package/package-types";

/**
 * Extracts environment variables from request headers.
 * Headers like `x-mcp-env-TAVILY_API_KEY: xxx` → { TAVILY_API_KEY: "xxx" }
 */
function extractEnvFromHeaders(req: IncomingMessage): Record<string, string> {
  const envs: Record<string, string> = {};
  const prefix = "x-mcp-env-";
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase().startsWith(prefix) && typeof value === "string") {
      // Node.js lowercases all header names, so restore the env key to UPPER_CASE
      const envKey = key.slice(prefix.length).toUpperCase();
      envs[envKey] = value;
    }
  }
  return envs;
}

/**
 * In-memory session store.
 * `envs` is mutable — updated on every request so that tool calls
 * always use the latest env vars the client sends.
 */
interface GatewaySession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  packageName: string;
  config: MCPServerPackageConfig;
  envs: Record<string, string>;
  createdAt: number;
}

const sessions = new Map<string, GatewaySession>();

/** Each session holds a proxy server in memory; past this many, new ones are turned away. */
const MAX_SESSIONS = 500;

const SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(
  () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        session.server.close().catch(() => {});
        sessions.delete(id);
      }
    }
  },
  5 * 60 * 1000,
);

/**
 * Creates a low-level MCP Server that proxies tools from the target package. Tools are listed and
 * run through the configured executor, so they land in the sandbox like any other tool call.
 *
 * The `sessionRef` object is shared with the session store so that
 * `envs` can be updated on every incoming HTTP request. The tools/call
 * handler always reads `sessionRef.envs` at call time (not at init time).
 */
async function createProxyServer(
  packageName: string,
  sessionRef: { envs: Record<string, string> },
): Promise<{ server: Server; tools: Tool[] }> {
  // Copies: the list is cached and shared, and the schemas get patched below
  const upstreamTools: Tool[] = (await getPackageTools(packageName)).map((tool) => ({
    ...tool,
    inputSchema: { ...tool.inputSchema },
  }));

  // Ensure each tool's inputSchema allows additional properties.
  // VSCode's AJV validator defaults to additionalProperties:false when
  // the field is missing, causing "must NOT have additional properties".
  for (const tool of upstreamTools) {
    if (tool.inputSchema && !("additionalProperties" in tool.inputSchema)) {
      (tool.inputSchema as Record<string, unknown>).additionalProperties = true;
    }
  }

  // Build a map of tool name → allowed property keys for argument filtering
  const toolPropertyKeys = new Map<string, Set<string>>();
  for (const tool of upstreamTools) {
    toolPropertyKeys.set(tool.name, new Set(Object.keys(tool.inputSchema?.properties ?? {})));
  }

  const server = new Server(
    { name: `alphesdk-gateway/${packageName}`, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log(
      `[MCP Gateway] tools/list for ${packageName}: returning ${upstreamTools.length} tools`,
    );
    return { tools: upstreamTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    // Filter to only schema-defined properties
    const allowedKeys = toolPropertyKeys.get(name);
    let args = rawArgs;
    if (allowedKeys && args) {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (allowedKeys.has(k)) {
          filtered[k] = v;
        }
      }
      args = filtered;
    }

    // Read envs from the shared session ref (always up-to-date)
    const envs = sessionRef.envs;
    console.log(
      `[MCP Gateway] tools/call ${packageName}/${name}`,
      JSON.stringify(args).slice(0, 300),
      `envKeys=[${Object.keys(envs).join(",")}]`,
    );

    return (await runPackageTool(packageName, name, args ?? {}, envs)) as CallToolResult;
  });

  return { server, tools: upstreamTools };
}

/**
 * Main request handler for the MCP Gateway.
 */
export function createMcpGatewayHandler(repository: PackageRepository) {
  return async (req: IncomingMessage, res: ServerResponse, packageName: string) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, mcp-session-id, x-mcp-env-*",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let config: MCPServerPackageConfig | undefined;
    try {
      config = repository.getPackageConfig(packageName);
    } catch {
      config = undefined;
    }

    // Blocked first: blacklisted keys are left out of the index, so they would otherwise look unknown.
    if (await isBlocked(config ?? { packageName }, packageName)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: new BlockedPackageError(packageName).message }));
      return;
    }

    if (!config) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Package '${packageName}' not found` }));
      return;
    }

    const reqEnvs = extractEnvFromHeaders(req);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    console.log(
      `[MCP Gateway] ${req.method} ${req.url} session=${sessionId ?? "(new)"}`,
      `envKeys=[${Object.keys(reqEnvs).join(",")}]`,
    );

    // Existing session — merge any new env vars and delegate
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      if (session) {
        // Merge env vars from this request into the session
        Object.assign(session.envs, reqEnvs);
        await session.transport.handleRequest(req, res);
        return;
      }
    }

    if (sessionId && !sessions.has(sessionId)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found or expired" }));
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "Too many open sessions, try again shortly" }));
      return;
    }

    // New session
    try {
      // Shared mutable ref so the tools/call handler always sees latest envs
      const sessionRef = { envs: { ...reqEnvs } };

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            transport,
            server: mcpServer,
            packageName,
            config,
            envs: sessionRef.envs,
            createdAt: Date.now(),
          });
        },
        onsessionclosed: (closedSessionId) => {
          sessions.delete(closedSessionId);
        },
        enableJsonResponse: true,
      });

      const { server: mcpServer } = await createProxyServer(packageName, sessionRef);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(`[MCP Gateway] Error for ${packageName}:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `Failed to initialize MCP gateway for ${packageName}`,
            // Upstream errors can carry paths and stderr; keep them in the log in production
            message:
              process.env.NODE_ENV !== "production" && error instanceof Error
                ? error.message
                : undefined,
          }),
        );
      }
    }
  };
}
