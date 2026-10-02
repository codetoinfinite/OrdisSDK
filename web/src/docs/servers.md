Every server in the catalog is an MCP package from the registry. This page explains the labels on them and what happens when one runs.

# Labels

| Label | Meaning |
|---|---|
| **Verified** | AlpheSDK started the server and read its tool list in a test run |
| **Remote** | The maker hosts the server, and the entry points at their address |
| **Needs keys** | At least one required key has no default, so add keys first |
| **Blocked** | On the hosting blacklist; AlpheSDK never runs it |

Verified means a server starts, not that it's safe or does what it says. Read what a server does before you give it keys.

# Runtimes

The runtime says what a server is built on: `node`, `python`, `go`, `java` or `docker`. Search can filter on it with the `runtime` parameter of the [REST API](/docs/rest-api).

# Where servers run

Remote servers run on their maker's side, and AlpheSDK connects to them. The AlpheSDK host starts every other server when it's needed.

- **MCP clients.** Servers used through the gateway always run on the host itself, as ordinary processes with the same access as the API.
- **Tool runs and agent chats.** These follow the host's `MCP_SANDBOX_PROVIDER` setting. `LOCAL`, the default, runs them on the host the same way; `DAYTONA`, `SANDOCK` or `E2B` start them in that provider's hosted sandbox, using the host's account key for it.

# The hosting blacklist

Some registry entries name a package that belongs to a different project than the one they describe. Running them would run someone else's code, so they're listed in `config/hosting-blacklist.mjs`. AlpheSDK leaves them out of search, refuses them at the gateway and for tool runs, and `pnpm validate:catalog` rejects tools and agents that use them.
