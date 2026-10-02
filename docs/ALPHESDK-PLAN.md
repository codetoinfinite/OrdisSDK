# AlpheSDK — rename, redesign and platform plan

Status: in progress · Owner: AlpheSDK team · Last updated: 2026-10-02

AlpheSDK turns this MCP registry into a full catalog of **MCP servers, tools and agents** with a
guided flow: find → inspect → configure → test → connect → run. The UI is a desktop-style web app
(menu bar, desktop icons, draggable windows) in the spirit of posthog.com, built from scratch.

## 1. Goals

1. Use the AlpheSDK name everywhere it is our brand (code, docs, configs, CI, package names we
   own), while keeping identifiers that belong to third parties.
2. Replace the single search page (`src/domains/search/search.html`) with a web app (`web/`) that
   has a real flow instead of one page.
3. Extend the catalog from "MCP servers" to three item types: **MCP servers**, **tools** and
   **agents**, with a file-based way to add more of each.
4. Keep everything that already works: the REST API, the MCP gateway (`/mcp/<package>`), sandboxed
   execution, search, OAuth, the 1,365 validated servers and the 309-entry hosting blacklist.

Non-goals (this phase): user accounts, multi-tenant auth, hosting the registry publicly, billing.

## 2. Starting point

| Area | Today |
|---|---|
| Catalog | 4,239 MCP server configs in `packages/<category>/*.json`, 1,365 validated, 309 blocked, 14,443 cached tool names in `indexes/packages-list.json` |
| API | Hono + zod-openapi on `127.0.0.1:3003`: packages detail/tools/run, config featured/categories, search (Meilisearch), OAuth, Swagger |
| Gateway | Raw `node:http` handler for `/mcp/<package>` (streamable HTTP, env via `x-mcp-env-*` headers) |
| UI | One static HTML page (`search.html`) with a search box and a run form |
| Agents | Only `demo/agent.mjs` (CLI, OpenRouter tool loop) |

## 3. Design direction

**Licence note.** posthog.com's own terms forbid copying its site ("Please do not duplicate, copy,
or use our website"). AlpheSDK gets an **original** design in the same style: same ideas (desktop
metaphor, windows, 3D buttons, marker highlights, coloured tab panels, docs-style cards), but our
own code, tokens, peak logo, icons, alpine SVG wallpaper and copy. No PostHog logos, hedgehogs,
fonts or assets.

### 3.1 Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F3F2EA` | `#16171B` | page behind wallpaper |
| `--surface` | `#FDFDF8` | `#1E1F24` | cards, inputs |
| `--surface-2` | `#EEEFE9` | `#25262C` | window body, sidebars |
| `--surface-3` | `#E5E7E0` | `#2D2E36` | hover, tab strip |
| `--window` | `rgba(238,239,233,.86)` | `rgba(30,31,36,.86)` | translucent window + blur |
| `--border` | `#BFC1B7` | `#3F414B` | 1px borders |
| `--text` | `#23251D` | `#EDEDE7` | body text |
| `--muted` | `#73756B` | `#9A9CA3` | secondary text |
| `--accent` | `#E8590C` | `#FF7A33` | brand orange (links, focus) |
| `--cta` / `--cta-edge` | `#F6A019` / `#C97A00` | same | primary 3D button face / bottom edge |
| `--marker` | `rgba(246,160,25,.28)` | `rgba(246,160,25,.30)` | text highlighter |
| `--blue` `--green` `--purple` `--teal` `--red` | small swatches, the one tab panel, states | lighter variants | |

Type: **IBM Plex Sans** (variable, OFL) for UI, **IBM Plex Mono** (OFL) for code, eyebrows and meta
lines, both self-hosted via fontsource. Weights 400–600; 700 only for the brand and headings.
Radius: windows 14px, cards 6px, buttons 6px. Buttons have a 3px darker bottom border and move down
1px on press. Icons: lucide (ISC).

Character rules (keep new pages consistent):

- Colour is ink, paper and one amber CTA. Hue appears only as small swatches, the one saturated
  tab panel on Home and semantic states (errors, warnings, callouts). Icons and categories stay
  monochrome.
- Item marks are keycaps (`Monogram`: initials or an icon on a raised tile), never coloured blobs.
- Steps are numbered `01`, `02`, `03` in mono; figures sit in ledger rows with mono labels.
- Section eyebrows: mono, 11px, uppercase, tracked, muted.
- Copy keeps the base camp theme lightly ("Get started" flag, "Off the trail" for 404).

### 3.2 Shell

```
┌ Menu bar ──────────────────────────────────────────────────────────────┐
│ ◆ AlpheSDK  Explore  Servers  Tools  Agents  Docs  More ▾   [Get started] ⌘K ◐ ▣ │
└────────────────────────────────────────────────────────────────────────┘
 Home        ┌ Window: Explore ─────────────────────────── ◀ ▶  – □ × ┐   My stack
 Explore     │                                                         │   Get started
 MCP servers │   (page content)                                        │   API reference
 Tools       │                                                         │   Settings
 Agents      │                                                         │   About
 Playground  └─────────────────────────────────────────────────────────┘
 Docs
```

- Window manager: open, focus, z-order, drag (title bar), resize (corner), minimise, maximise,
  close, per-window back/forward history. The URL always mirrors the focused window's path, so
  deep links and browser back/forward work.
- One main window holds the pages (Home, Explore, server/tool/agent detail, Docs, My stack,
  Get started): desktop icons, menu items, palette results and links change its content and add
  to its back/forward history, restoring it if minimised. Playground, Settings and About open in
  their own window, focused instead of duplicated when opened again, so a running tool or chat is
  never replaced; their links to pages go to the main window. ⌘/Ctrl/Shift-click opens an extra
  window. The API reference opens in a browser tab.
- ⌘K command palette: search the whole catalog plus commands (open app, toggle theme).
- Mobile (<768px): no desktop icons, one full-screen window, menu collapses into a sheet.
- Settings: theme (system/light/dark), wallpaper (alpine scene or 4 CSS presets), reduced motion.

## 4. Flow and pages

Primary flow, reachable from Home → **Get started**:

1. **Discover** — Explore: search + type tabs + category sidebar + filters.
2. **Inspect** — detail window for a server, tool or agent.
3. **Configure** — enter required keys (kept in the browser; see §8).
4. **Test** — list tools live and run one in the sandbox.
5. **Connect** — copy a config for Claude Code, Claude Desktop, Cursor, VS Code, REST or SDK.
6. **Run** — chat with an agent that uses the chosen servers.

The Get started window shows these steps as a checklist that ticks itself as the user goes.

| Route | Window | Content |
|---|---|---|
| `/` | Home | Hero with marker highlights and search, "Today in the catalog" ledger with live stats and 3D CTA, coloured tabbed panel (Find · Test · Connect · Run), how it works (01–06 trail), categories, featured servers, agents, curated tools |
| `/explore`, `/servers`, `/tools`, `/agents` | Explore | Type tabs All / MCP servers / Tools / Agents; category sidebar with counts; filters verified, runtime, needs keys, hide blocked; sort; result cards; load more. Query string holds state (`?q=&category=&verified=1…`) |
| `/servers/<package>` | Server | Header (monogram, name, package, badges, actions Set up / Add to stack / Source). Tabs **Overview** (description, facts, env vars, tool preview), **Tools** (list + runner with schema form), **Set up** (wizard: Configure → Test → Connect) |
| `/tools/<key>` | Tool | Curated tool: description, linked server, runner for its MCP tool |
| `/agents/<key>` | Agent | Description, servers used, key status, starter prompts, chat with streamed tool calls |
| `/playground` | Playground | Tool runner (any server/tool) and ad-hoc agent chat over up to 3 servers |
| `/stack` | My stack | Saved servers, tools and agents; key status; export combined client config |
| `/start` | Get started | Onboarding checklist with links into each step |
| `/docs`, `/docs/<slug>` | Docs | Docs-style card index + markdown pages |
| `/settings` | Settings | Theme, wallpaper, motion |
| `/about` | About | What AlpheSDK is, credits and licences |

MCP-server tools open inside their server window: `/servers/<package>?tab=tools&tool=<name>`.

## 5. Catalog data model

Three sources, one search index.

**MCP servers** — unchanged: `packages/<category>/<file>.json` (`MCPServerPackageConfigSchema`),
listed in `indexes/packages-list.json` (category, path, validated, cached tools).

**Agents** — `agents/<category>/<key>.json`:

```json
{
  "type": "agent",
  "key": "web-researcher",
  "name": "Web Researcher",
  "description": "Searches the web and summarises sources with citations.",
  "category": "search-data-extraction",
  "tags": ["research"],
  "author": "AlpheSDK",
  "model": "optional OpenRouter model id",
  "systemPrompt": "You are…",
  "servers": [{ "server": "<packageName>", "tools": ["optional", "allow-list"] }],
  "starterPrompts": ["Find three recent articles about…"],
  "maxSteps": 6
}
```

Runnable when it has a `systemPrompt`, at least one server, and every server exists and is not
blocked.

**Tools** — `tools/<category>/<key>.json` (curated, human-named entry points):

```json
{
  "type": "tool",
  "key": "fetch-url",
  "name": "Fetch a URL",
  "description": "Fetch a web page and return it as markdown.",
  "category": "search-data-extraction",
  "tags": ["web"],
  "mcp": { "server": "<packageName>", "tool": "<toolName>" }
}
```

Runnable when `mcp` points at an existing, unblocked server. Every MCP server tool is also indexed
as a `tool` document automatically, so curated tools are the featured subset.

Validation: zod schemas in `src/domains/catalog/catalog-schema.ts`; `pnpm validate:catalog` fails
CI on bad files; invalid files are skipped (and logged) at startup. Categories must be keys from
`config/categories.mjs`.

Adding items: drop a JSON file in the right folder, run `pnpm validate:catalog`, then reload with
`POST /api/v1/search/manage/index` (or restart). Docs page "Add to the catalog" documents all three.

## 6. API contract

Envelope unchanged: `{ success, code, message, data }`. Existing endpoints keep working.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v1/catalog/stats` | `{ servers: { total, validated, blocked, remote, needsKeys, byRuntime }, tools: { total, curated }, agents: { total, runnable }, categories, version, search: { engine, documents } }` |
| GET | `/api/v1/catalog/categories` | `[{ key, name, description, counts: { mcp, tool, agent } }]` |
| GET | `/api/v1/catalog/featured` | `{ servers: ServerSummary[], tools: ToolSummary[], agents: AgentSummary[] }` |
| GET | `/api/v1/catalog/server?packageName=` | `ServerDetail` (config + category name, validated, blocked, blockReason, needsKeys, cached tools, `connect: { gatewayPath, stdio?, remoteUrl? }`) — no process spawn |
| GET | `/api/v1/catalog/agents` · `/agent?key=` | `AgentSummary[]` · `AgentDetail` (with resolved servers and `runnable`, `issues[]`) |
| GET | `/api/v1/catalog/tools` · `/tool?key=` | curated `ToolSummary[]` · `ToolDetail` (with resolved server) |
| GET | `/api/v1/search` | unified search. Params: `q, type, category, validated, runtime, needsKeys, blocked, server, sort, limit, offset, facets` (comma list). Returns `{ hits, estimatedTotalHits, limit, offset, processingTimeMs, facetDistribution?, engine }` |
| GET | `/api/v1/search/suggest?q=` | `{ suggestions: [{ id, type, name, packageName?, server?, toolName?, key?, category }] }` |
| POST | `/api/v1/search/manage/index` | reload `agents/` + `tools/`, reindex all three types |
| POST | `/api/v1/agents/chat` | Server-sent events. Body `{ agentKey?, servers?: [{ server, tools? }], messages: [{ role, content }], envs?: { [packageName]: { KEY: value } }, model? }`. Events `status`, `tool_call {id, server, tool, args}`, `tool_result {id, ok, ms, preview}`, `message {content}`, `error {message}`, `done {steps, model}` |
| GET | `/api/v1/packages/tools` | unchanged, now memoised per package for 10 minutes |

Search documents: `{ id, type: "mcp"|"tool"|"agent", name, description, category, validated,
blocked, popularity, … }` plus per type: mcp `packageName, runtime, toolCount, envCount,
needsKeys`; tool `server, serverName, toolName, curated, key?`; agent `key, servers, runnable`.
Index name `alphesdk-catalog`; `type` is filterable and faceted. If Meilisearch is down, the same
endpoint answers from an in-memory index (`engine: "memory"`) so the UI keeps working.

The agent runner is a server-side port of `demo/agent.mjs`: OpenRouter chat completions with
tool calling, at most `maxSteps` (default 6, cap 10) rounds, tools restricted to the agent's
declared servers (and allow-lists), blocked servers refused, tool results truncated before they go
back to the model. Model: agent `model` → request `model` → `OPENROUTER_MODEL` → default.

## 7. Naming

Our names:

| Name | Where |
|---|---|
| `AlpheSDK` (prose) | README, docs, templates, skill, comments, schema descriptions |
| `@alphesdk/registry` | `package.json` |
| `@alphesdk-remote/<name>` | remote-server package configs, both indexes, generator, validator, utils, tests, skill |
| `packages/**/alphesdk-remote-*.json` | file names + `path` fields in `packages-list.json` |
| `alphesdk-gateway/<pkg>` | gateway MCP server name |
| `alphesdk-registry` | `docker-compose.yml` service / container, log `service.name`, image, `deploy-alphesdk-registry.yaml` |
| Meilisearch index `alphesdk-catalog` | `search-so.ts` |

Keep (not ours):

- Third-party identifiers inside package configs: npm package names, repository URLs and tracking
  links.
- `LICENSE` (MIT) with its copyright notice.

## 8. Security

- The API binds to `127.0.0.1` by default and runs MCP packages on this machine; keep it local.
  Docker sets `HOST=0.0.0.0` inside the container only.
- Keys typed in the UI live in `sessionStorage` (opt-in `localStorage` via "Remember on this
  device"), travel only in POST bodies or `x-mcp-env-*` headers to the local server, never in URLs,
  and are masked in exported configs unless the user ticks "Include secrets".
- `OPENROUTER_API_KEY` stays server-side (`.env.local`); the browser never sees it.
- Package descriptions and tool output are untrusted: rendered as text through React, never via
  `innerHTML`. Search highlights are parsed into `<mark>` elements, not injected as HTML. Docs
  markdown is our own, bundled at build time.
- Blocked packages cannot be run, listed live, used by agents or reached through the gateway.
- Agents can only call tools of their declared servers; step count and output size are capped.

## 9. Build and run

- `web/`: Vite + React + TypeScript, plain CSS tokens, lucide icons, fontsource fonts, `marked`
  for bundled docs. Own `package.json` and lockfile.
- `pnpm dev` (API, 3003) + `pnpm web:dev` (Vite, proxies `/api`, `/mcp`, `/swagger`, `/demo`).
- `pnpm web:build` → `web/dist`, served by Hono at `/` with an SPA fallback for non-API routes.
- Dockerfile builds `web/` before starting the API.

## 10. Phases

| # | Phase | Done when |
|---|---|---|
| 0 | Backup + plan | backup tarball in `../backups/`, this document |
| 1 | Rename | our names (§7) used everywhere outside the keep-list; `validate:registry`, tests, `tsc`, biome pass; search reindexed |
| 2 | Catalog backend | schemas, `agents/` + `tools/` seeds, repository, catalog routes, unified search + fallback, agent chat SSE, SPA serving |
| 3 | Web app | design system, shell + window manager, all pages in §4, mobile layout |
| 4 | Integration | scripts, Dockerfile, README/docs updated, `search.html` removed |
| 5 | Verification | browser pass over every route (light/dark, desktop/mobile), a tool run and an agent chat end-to-end |

Later: "Add to catalog" form in the UI, per-user auth if the registry is ever exposed beyond
localhost, streaming tool output, usage analytics.
