Servers come from the MCP registry. Agents and curated entries are small JSON files in this repository, so you can add one in a few minutes without writing code.

# Add a tool

A curated tool gives one tool of one server a friendly name, a description and a place in search. Create `tools/<category>/<key>.json`:

```json
{
  "type": "tool",
  "key": "echo",
  "name": "Echo",
  "description": "Send a message and get it back unchanged; handy for testing a connection.",
  "category": "developer-tools",
  "tags": ["testing"],
  "mcp": {
    "server": "@modelcontextprotocol/server-everything",
    "tool": "echo"
  }
}
```

- `key` is lowercase kebab-case and matches the file name.
- `category` is a key from `config/categories.mjs`; put the file in the folder of the same name.
- `mcp.server` is the server's package name, and `mcp.tool` is the tool's name as that server lists it.

# Add an agent

Create `agents/<category>/<key>.json`:

```json
{
  "type": "agent",
  "key": "problem-solver",
  "name": "Problem Solver",
  "description": "Breaks problems into steps and checks the arithmetic with a calculator.",
  "category": "other-tools-and-integrations",
  "tags": ["reasoning", "math"],
  "systemPrompt": "You solve problems step by step. Plan with the sequential thinking tool when a problem has several parts, do every calculation with the calculator tool, and finish with a short answer followed by the key steps.",
  "servers": [
    { "server": "@modelcontextprotocol/server-sequential-thinking", "tools": ["sequentialthinking"] },
    { "server": "mcp-server-calculator", "tools": ["calculate"] }
  ],
  "starterPrompts": ["What is 17% of 2,340, rounded to two decimals?"],
  "maxSteps": 8
}
```

| Field | Notes |
|---|---|
| `systemPrompt` | What the agent is for and how it should use its tools |
| `servers` | 1 to 5 servers; `tools` limits which of a server's tools it may call |
| `starterPrompts` | Suggested messages shown while the chat is empty |
| `maxSteps` | 1 to 10 model calls per reply, 6 if left out |
| `model` | Optional OpenRouter model id for this agent |
| `author`, `tags` | Optional |

# Check and load

```bash
pnpm validate:catalog
```

The check reports invalid JSON, schema errors, a key that doesn't match its file name, unknown categories, duplicate keys, and servers or tools that don't exist or are blocked. It exits with code 1 when anything is wrong.

Then restart the API, or reload the catalog in place:

```bash
curl -s -X POST {{origin}}/api/v1/search/manage/index
```

Reload this app to see the new entries.

> Like the rest of the API, the management routes have no login. Keep the API on 127.0.0.1, its default, unless everyone who can reach it is trusted.

# Add a server

Servers live in `packages/<category>/`, one JSON file per package. Check a new file with `make validate packages/<category>/<file>.json`, then run `make build`. The build rebuilds `indexes/packages-list.json` and starts each new server once to test it; a server that starts and lists its tools gets the Verified label. These scripts need Bun. Reload the catalog as above to see the server.
