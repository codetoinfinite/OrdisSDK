Every server in the catalog is reachable through the AlpheSDK gateway, so any client that speaks MCP over Streamable HTTP can use it. The Setup tab of each server, and My stack, write these configs for you with the right names and key headers.

# The gateway

```
{{origin}}/mcp/<packageName>
```

Scoped package names keep their slash, for example `{{origin}}/mcp/@modelcontextprotocol/server-everything`.

- A client's first request opens a session, and the response carries an `mcp-session-id` header. Send it back with later requests. Each session ends 30 minutes after it opens; a new `initialize` request opens another.
- When the server sets `ALPHE_SDK_API_KEYS`, every request also needs `Authorization: Bearer <key>` (or `x-api-key: <key>`), or it gets a 401. Add it like any other header below.
- Keys go in headers named `x-mcp-env-<NAME>`, such as `x-mcp-env-GITHUB_PERSONAL_ACCESS_TOKEN`. The server gets them as environment variables.
- A blocked or unknown package gets a JSON error, such as `{"error":"Package 'x' not found"}`, instead of a session.

# Claude Code

```bash
claude mcp add --transport http everything {{origin}}/mcp/@modelcontextprotocol/server-everything
```

Add one `--header` per key. Written as `$NAME`, the value comes from your shell, so the key isn't saved in your command history:

```bash
claude mcp add --transport http github {{origin}}/mcp/@modelcontextprotocol/server-github \
  --header "x-mcp-env-GITHUB_PERSONAL_ACCESS_TOKEN: $GITHUB_PERSONAL_ACCESS_TOKEN"
```

Servers are added for the current project; add `--scope user` to use them in every project.

# Cursor

Save this as `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "github": {
      "url": "{{origin}}/mcp/@modelcontextprotocol/server-github",
      "headers": { "x-mcp-env-GITHUB_PERSONAL_ACCESS_TOKEN": "<your token>" }
    }
  }
}
```

# VS Code

Save this as `.vscode/mcp.json`. VS Code asks for each input the first time the server starts, so the key never sits in the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "GITHUB_PERSONAL_ACCESS_TOKEN",
      "description": "GitHub personal access token",
      "password": true
    }
  ],
  "servers": {
    "github": {
      "type": "http",
      "url": "{{origin}}/mcp/@modelcontextprotocol/server-github",
      "headers": { "x-mcp-env-GITHUB_PERSONAL_ACCESS_TOKEN": "${input:GITHUB_PERSONAL_ACCESS_TOKEN}" }
    }
  }
}
```

# Claude Desktop

Claude Desktop starts local commands listed in `claude_desktop_config.json`. Bridge it to the gateway with `mcp-remote`:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "{{origin}}/mcp/@modelcontextprotocol/server-everything"]
    }
  }
}
```

Add `"--allow-http"` to the args when the address starts with `http:`. For packages with a standard launcher, the Setup tab can also write a config that starts the server on your own machine without the gateway. Restart Claude Desktop after saving.

# From your own code

With the official TypeScript SDK (`npm i @modelcontextprotocol/sdk`):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("{{origin}}/mcp/@modelcontextprotocol/server-everything"),
);
const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({ name: "echo", arguments: { message: "hello" } });
```

Pass keys as `{ requestInit: { headers: { "x-mcp-env-NAME": value } } }`, the transport's second argument.

With curl, initialize first, then send the `mcp-session-id` it returns with every call:

```bash
curl -si -X POST {{origin}}/mcp/@modelcontextprotocol/server-everything \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'

curl -s -X POST {{origin}}/mcp/@modelcontextprotocol/server-everything \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <session id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```
