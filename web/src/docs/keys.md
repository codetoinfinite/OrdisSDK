Some servers need keys, such as an API token for the service they wrap. AlpheSDK keeps them in your browser and sends them only to this AlpheSDK host, and only for the server they belong to.

# Where keys are kept

- **This tab only.** By default, saved keys live in the browser's session storage and are gone when you close the tab.
- **Remember on this device.** Tick this in the key form to also keep them in local storage, so they survive a restart. Only do this on a device you trust.

Keys are saved per server. Clear one server's keys with **Clear** in its key form, or all of them in [Settings](/settings).

# How keys reach a server

This app sends keys only to this AlpheSDK host:

| When | How |
|---|---|
| You run a tool here | In the `envs` field of the request body |
| You chat with an agent here | In the `envs` field, grouped by server |
| Your MCP client connects | The client sends them as `x-mcp-env-<NAME>` headers to the gateway |

Keys are never put in a URL, so they stay out of browser history and access logs. The host hands them to the server as environment variables.

# Configs you copy

Configs and code samples show placeholders such as `<GITHUB_PERSONAL_ACCESS_TOKEN>` or `$GITHUB_PERSONAL_ACCESS_TOKEN`. Tick **Include my keys in the config** to paste your saved values instead. The snippet then holds the key in plain text, so keep that file out of version control and don't share it.

# Who can see them

Whoever runs the AlpheSDK host can read the keys that pass through it, and so can the server you use them with. Only use keys with hosts and servers you trust, and give each token the narrowest access the server needs.

The key for the agent chat model, `OPENROUTER_API_KEY`, works differently: it's set on the host and never sent to the browser.
