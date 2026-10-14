import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { agentRoutes } from "../domains/agent/agent-route";
import { catalogRoutes } from "../domains/catalog/catalog-route";
import { configRoutes } from "../domains/config/config-route";
import { createMcpGatewayHandler } from "../domains/mcp-gateway/mcp-gateway";
import { oauthDemoRoutes, oauthRoutes } from "../domains/oauth/oauth-route";
import { repository } from "../domains/package/package-handler";
import { packageRoutes } from "../domains/package/package-route";
import { initRegistryFactory } from "../domains/registry/registry-factory";
import { startSearch } from "../domains/search/search-handler";
import { searchRoutes } from "../domains/search/search-route";
import { createPostHogLogEmitter } from "../shared/config/posthog-log-emitter";
import { assertProductionConfig, isApiKeyValid, presentedApiKey } from "../shared/config/security";
import { getDirname } from "../shared/utils";
import { createErrorResponse } from "../shared/utils/response-util";
import { mountWebApp } from "./web-app";

// Before anything starts: a production server without keys or a sandbox would be open to anyone
assertProductionConfig();

const isProduction = process.env.NODE_ENV === "production";

// Initialize Registry Factory with the local repository
initRegistryFactory(repository);

// Catalog search: in memory right away, Meilisearch in the background when ENABLE_SEARCH=true
startSearch();

const __dirname = getDirname(import.meta.url);

// Served at / until the web app is built
const notBuiltHtml = `<!doctype html>
<meta charset="utf-8">
<title>AlpheSDK</title>
<p>The AlpheSDK API is running, but the web app isn't built yet. Run <code>pnpm web:build</code> and reload.</p>
<p>API reference: <a href="/swagger">/swagger</a></p>`;

export const app = new OpenAPIHono();

app.use("*", secureHeaders());
app.use("/api/*", bodyLimit({ maxSize: 5 * 1024 * 1024 }));

/** Rejects requests without a valid ALPHE_SDK_API_KEYS key (a no-op when none are set). */
const requireApiKey: MiddlewareHandler = async (c, next) => {
  if (!isApiKeyValid(presentedApiKey((name) => c.req.header(name)))) {
    return c.json(createErrorResponse("Missing or invalid API key", 401), 401);
  }
  await next();
};

// Routes that start servers, spend provider keys or change the index. The catalog, search and the
// OAuth callback (reached by the provider's redirect) stay public.
for (const path of [
  "/api/v1/packages/run",
  "/api/v1/packages/tools",
  "/api/v1/packages/detail",
  "/api/v1/agents/*",
  "/api/v1/search/manage/*",
  "/api/v1/oauth/prepare",
  "/api/v1/oauth/refresh",
]) {
  app.use(path, requireApiKey);
}

// Domain routes
app.route("/api/v1", packageRoutes);
app.route("/api/v1/config", configRoutes);
app.route("/api/v1/oauth", oauthRoutes);
app.route("/api/v1/catalog", catalogRoutes);
app.route("/api/v1/search", searchRoutes);
app.route("/api/v1/agents", agentRoutes);

// Demo routes (serves demo-oauth.html and handles callbacks); development only
if (!isProduction) {
  app.route("/demo", oauthDemoRoutes);
}

// Liveness probe for Docker and load balancers; public and cheap
app.get("/healthz", (c: Context) => c.json({ status: "ok" }));

app.get("/api/meta", async (c: Context) => {
  try {
    const packageJson = await import("../../package.json", {
      assert: { type: "json" },
    });
    return c.json({ version: packageJson.default.version });
  } catch (error) {
    console.error("Failed to load package.json:", error);
    return c.json({ version: "unknown" });
  }
});

// OpenAPI documentation
app.doc("/api/v1/doc", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "AlpheSDK API",
  },
});

// Swagger UI
app.get("/swagger", swaggerUI({ url: "/api/v1/doc" }));

// Web app (web/dist) with SPA fallback; last, so every API route wins
mountWebApp(app, join(__dirname, "../../web/dist"), notBuiltHtml);

app.notFound((c: Context) => {
  return c.json({ success: false, code: 404, message: "[Registry API] Route not found" }, 404);
});

app.onError((err: Error, c: Context) => {
  console.error("Server Error:", err);
  return c.json(
    {
      success: false,
      code: 500,
      // Messages can carry paths, stderr or upstream responses; production keeps them in the log
      message: isProduction
        ? "[Registry API] Internal server error"
        : `[Registry API] Internal server error, errMsg: ${err.message}`,
    },
    500,
  );
});

export const posthogLogger = createPostHogLogEmitter();

// MCP Gateway handler — intercepts /mcp/:packageName before Hono
const mcpGatewayHandler = createMcpGatewayHandler(repository);
const MCP_PATH_PREFIX = "/mcp/";

// A raw Node.js request listener so we can route /mcp/* to the
// Streamable HTTP transport (which needs raw IncomingMessage/ServerResponse)
// and everything else to Hono.
const honoListener = getRequestListener(app.fetch);

function headerOf(req: IncomingMessage, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function requestListener(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "";

  if (url.startsWith(MCP_PATH_PREFIX)) {
    // Extract package name: /mcp/@scope/name or /mcp/name
    // Handle scoped packages: /mcp/@scope/name → @scope/name
    const pathAfterPrefix = url.slice(MCP_PATH_PREFIX.length);
    // Remove query string if any
    const packageName = decodeURIComponent(pathAfterPrefix.split("?")[0]);

    if (!packageName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing package name in URL" }));
      return;
    }

    // CORS preflights carry no credentials; the gateway answers them itself
    if (
      req.method !== "OPTIONS" &&
      !isApiKeyValid(presentedApiKey((name) => headerOf(req, name)))
    ) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "Missing or invalid API key" }));
      return;
    }

    try {
      posthogLogger.emit("info", "mcp_gateway_request_received", { component: "mcp_gateway" });
      await mcpGatewayHandler(req, res, packageName);
    } catch (error) {
      console.error("[MCP Gateway] Unhandled error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }

  // All other routes → Hono
  honoListener(req, res);
}
