import { createServer } from "node:http";
import { getServerPort } from "../shared/config/environment";
import { app, posthogLogger, requestListener } from "./app";

const port = getServerPort();
const server = createServer(requestListener);

// Default to loopback: this server runs arbitrary MCP packages with no auth. Set HOST=0.0.0.0 to expose (e.g. in Docker).
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  posthogLogger.emit("info", "registry_server_started", { component: "api_server" });
  console.log(`🚀 Server is running on http://localhost:${port}`);
  console.log(`🔌 MCP Gateway available at http://localhost:${port}/mcp/<packageName>`);
});

export default app;
