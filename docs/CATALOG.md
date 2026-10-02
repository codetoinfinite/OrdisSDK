# AlpheSDK catalog

The catalog is everything the web app lists and searches. It has three item types:

| Type | Source | Search `type` |
| --- | --- | --- |
| MCP server | `packages/<category>/*.json`, listed in `indexes/packages-list.json` | `mcp` |
| Tool | `tools/<category>/<key>.json` (curated), plus every tool a server lists in `packages-list.json` | `tool` |
| Agent | `agents/<category>/<key>.json` | `agent` |

Categories come from `config/categories.mjs`, featured servers from `config/featured.mjs` and the
hosting blacklist from `config/hosting-blacklist.mjs`.

## Add an MCP server

Follow [CONTRIBUTING.md](CONTRIBUTING.md): add one JSON file under `packages/<category>/` and check
it with `pnpm validate:registry`. The catalog reads servers from `indexes/packages-list.json`, which
the registry build generates (`scripts/indexing-lists.ts`), so a new server appears once that index
includes it.

## Add a tool

A curated tool is a named entry point to one tool of one server. Create
`tools/<category>/<key>.json`:

```json
{
  "type": "tool",
  "key": "current-weather",
  "name": "Current weather",
  "description": "Get the current weather for a city.",
  "category": "location-services",
  "tags": ["weather"],
  "mcp": { "server": "mcp_weather_server", "tool": "get_current_weather" }
}
```

| Field | Rule |
| --- | --- |
| `type` | `"tool"` |
| `key` | lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), equal to the file name, unique among tools |
| `name`, `description` | non-empty text |
| `category` | a key from `config/categories.mjs`; the folder should have the same name |
| `tags` | optional list of non-empty strings |
| `mcp.server` | registry key of the server (the key in `indexes/packages-list.json`) |
| `mcp.tool` | tool name exactly as the server lists it |

No other fields are allowed. A curated tool replaces the automatic search entry for the same
server tool.

## Add an agent

An agent is a system prompt plus the servers (and optionally the tools) it may use. Create
`agents/<category>/<key>.json`:

```json
{
  "type": "agent",
  "key": "weather-reporter",
  "name": "Weather Reporter",
  "description": "Reports current weather, forecasts and air quality for any city.",
  "category": "location-services",
  "tags": ["weather"],
  "author": "AlpheSDK",
  "systemPrompt": "You report the weather. Use the weather tools for every answer.",
  "servers": [
    { "server": "mcp_weather_server", "tools": ["get_current_weather", "get_air_quality"] }
  ],
  "starterPrompts": ["What is the weather in Berlin right now?"],
  "maxSteps": 5
}
```

| Field | Rule |
| --- | --- |
| `type` | `"agent"` |
| `key`, `name`, `description`, `category`, `tags` | as for tools |
| `author` | optional text |
| `model` | optional OpenRouter model id; otherwise the chat request's `model`, then `OPENROUTER_MODEL`, then `anthropic/claude-sonnet-5` |
| `systemPrompt` | non-empty text |
| `servers` | 1–5 entries, each server listed once; `tools` is an optional allow-list (omit it to allow every tool of that server) |
| `starterPrompts` | optional list of prompts the UI offers |
| `maxSteps` | model calls per chat turn, 1–10, default 6 |

## Validate

```sh
pnpm validate:catalog
```

It prints one line per problem and exits with code 1 when there is an error.

Errors:

- invalid JSON or a schema violation (the file is skipped);
- a `key` that differs from the file name, or a key used twice (the file is skipped);
- a `category` missing from `config/categories.mjs`;
- a package config under `packages/` that fails the registry schema;
- a tool or agent that uses a server missing from the registry or on the hosting blacklist;
- a tool (curated or in an agent's allow-list) the server does not list in `packages-list.json`.

Warnings: a folder name that differs from the item's `category`.

## Runnable and blocked

- A tool or agent is **runnable** when every server it uses is in the registry and not blocked.
  The API reports `runnable` and the reasons (`issues`) on every tool and agent.
- A server is **blocked** when its registry key or package name is in
  `config/hosting-blacklist.mjs`. The registry build leaves blacklisted packages out of
  `indexes/packages-list.json`, so they are not in the catalog or search; one that is still in the
  index is listed with `blocked: true` and a `blockReason`. The API refuses to run them everywhere:
  - `GET /api/v1/packages/detail`, `/packages/tools` and `POST /packages/run`: envelope with code
    403, `Package '<key>' is blocked (hosting blacklist)`;
  - the MCP gateway `/mcp/<key>`: HTTP 403 `{"error":"Package '<key>' is blocked (hosting blacklist)"}`;
  - agent chat: `error` event `Server '<key>' is blocked (hosting blacklist)`, then `done`.

## Reload

The API loads the catalog at startup. After editing `tools/`, `agents/`, `packages/` or
`indexes/packages-list.json`, reload the catalog and rebuild the search index without a restart:

```sh
curl -X POST http://127.0.0.1:3003/api/v1/search/manage/index
```

Edits to `config/*.mjs` need an API restart.

## Endpoints

All under `/api/v1`, returning `{ success, code, message, data }` unless noted. Response shapes are
in `src/domains/catalog/catalog-types.ts` (the web app's copy is `web/src/lib/types.ts`); the
OpenAPI document is at `/api/v1/doc` and Swagger UI at `/swagger`.

| Method and path | Returns |
| --- | --- |
| `GET /catalog/stats` | counts of servers, tools, agents and categories, the version and the search engine |
| `GET /catalog/categories` | every category with counts per item type |
| `GET /catalog/featured` | featured servers, tools and agents |
| `GET /catalog/server?packageName=` | one server: summary, tools, env vars and how to connect |
| `GET /catalog/tools`, `GET /catalog/tool?key=` | curated tools; one tool with its server |
| `GET /catalog/agents`, `GET /catalog/agent?key=` | agents; one agent with its prompt and resolved servers |
| `GET /search` | search: `q`, `type`, `category`, `validated`, `runtime`, `needsKeys`, `blocked`, `server`, `sort` (`relevance`, `popularity:desc`, `name:asc`), `limit` (0–100, default 20), `offset`, `facets` (comma-separated: `type`, `category`, `validated`, `runtime`, `needsKeys`, `blocked`, `remote`, `tags`, `author`) |
| `GET /search/suggest?q=&limit=` | quick suggestions for the search box |
| `GET /search/facets`, `GET /search/health` | facet values; search engine status |
| `GET /search/manage/stats`, `POST /search/manage/init`, `POST /search/manage/index`, `POST /search/manage/clear` | index maintenance |
| `POST /agents/chat` | agent chat as Server-Sent Events (below) |

Search uses Meilisearch when `ENABLE_SEARCH=true` and it is reachable, and an in-memory engine
with the same parameters and result shape otherwise (`data.engine` says which). Highlights in
`_formatted` wrap matches in `<mark>` but are not HTML-escaped: render them as text split on the
marks, never as HTML.

### Agent chat

`POST /api/v1/agents/chat` with a JSON body:

```json
{
  "agentKey": "weather-reporter",
  "messages": [{ "role": "user", "content": "Weather in Berlin?" }],
  "envs": { "mcp_weather_server": { "SOME_KEY": "value" } },
  "model": "anthropic/claude-sonnet-5"
}
```

Instead of `agentKey`, an ad-hoc chat passes `servers` (1–3 entries, same format as in an agent
file). `messages` holds 1–50 messages of role `user` or `assistant`. An invalid body gets the JSON
envelope with code 400. Otherwise the response is a stream of events whose `data` is JSON:

| Event | Data |
| --- | --- |
| `status` | `{ message }` progress, such as loading tools or the step limit |
| `tool_call` | `{ id, server, tool, args }` |
| `tool_result` | `{ id, ok, ms, preview }` (preview cut at 2,000 characters) |
| `message` | `{ content }` the model's reply |
| `error` | `{ message }` |
| `done` | `{ steps, model }`, always last unless the client disconnected |

Chat needs `OPENROUTER_API_KEY` on the server; without it every chat ends with the error
`Agent chat is not configured on this server`. Each `envs` entry goes only to that server's tools.
