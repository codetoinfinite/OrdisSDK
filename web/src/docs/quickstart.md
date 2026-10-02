AlpheSDK lists MCP servers, the tools they offer and ready-made agents, and runs them for you through one gateway. This page takes you from a fresh checkout to a working connection.

# Run AlpheSDK

You need Node.js 24 and pnpm 9. The API and this web app are two projects in one repository, so install and start both:

```bash
# API and MCP gateway, on http://127.0.0.1:3003
pnpm install
pnpm dev

# In a second terminal: the web app, on http://127.0.0.1:5173
pnpm --dir web install
pnpm web:dev
```

The web app forwards `/api`, `/mcp` and `/swagger` to the API, so everything is reachable from one address. To run one server instead of two, build the web app once with `pnpm web:build`; the API then serves it at http://127.0.0.1:3003.

Agent chat also needs an OpenRouter key on the server. Put `OPENROUTER_API_KEY` in `.env.local` next to the root `package.json`, and optionally `OPENROUTER_MODEL` to change the default model. Everything else works without it.

> The API runs MCP packages for anyone who can reach it and has no login. It listens on 127.0.0.1 unless you set `HOST`, so only widen that for people you trust.

# The six steps

The [Get started](/start) checklist walks through these and ticks each one off as you do it.

1. **Discover.** Search the catalog in [Explore](/explore) and narrow it down with the filters.
2. **Inspect.** Open a server to see what it does, the tools it offers and the keys it needs.
3. **Configure.** Add keys on the server's Setup tab. They stay in your browser; see [Keys and privacy](/docs/keys).
4. **Test.** Run a tool from the server's Tools tab or the [Playground](/playground) and check the raw result.
5. **Connect.** Copy a config for your MCP client from the Setup tab. See [Connect an MCP client](/docs/connect-clients).
6. **Run.** Chat with an agent and watch which tools it calls. See [Agent chat](/docs/agents).

# Keep what you use

Add servers, tools and agents to [My stack](/stack) as you go. It writes one config for all your servers and lets you chat with them together.
