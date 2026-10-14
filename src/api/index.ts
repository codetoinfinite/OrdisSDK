import { createServer } from "node:http";
import { getServerPort } from "../shared/config/environment";
import { app, posthogLogger, requestListener } from "./app";

const port = getServerPort();
const server = createServer(requestListener);

// Default to loopback. Set HOST=0.0.0.0 to expose (e.g. in Docker), with ALPHE_SDK_API_KEYS set.
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  posthogLogger.emit("info", "registry_server_started", { component: "api_server" });
  console.log(`🚀 Server is running on http://localhost:${port}`);
  console.log(`🔌 MCP Gateway available at http://localhost:${port}/mcp/<packageName>`);
});

// `docker stop` sends SIGTERM: finish in-flight requests, then exit (Docker kills after 10s anyway)
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

export default app;
