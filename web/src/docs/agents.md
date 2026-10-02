An agent pairs a system prompt with a few MCP servers. You send the conversation; the agent calls tools as it needs them and streams everything back as server-sent events.

# Send a chat

```bash
curl -N -X POST {{origin}}/api/v1/agents/chat \
  -H "Content-Type: application/json" \
  -d '{"agentKey":"everything-tester","messages":[{"role":"user","content":"Add 2 and 3"}]}'
```

That call streamed back:

```
event: status
data: {"message":"Loading tools from Everything MCP Server"}

event: status
data: {"message":"2 tool(s) ready"}

event: tool_call
data: {"id":"toolu_01PE…","server":"@modelcontextprotocol/server-everything","tool":"add","args":{"a":2,"b":3}}

event: tool_result
data: {"id":"toolu_01PE…","ok":true,"ms":59,"preview":"The sum of 2 and 3 is 5."}

event: message
data: {"content":"The sum of 2 and 3 is 5."}

event: done
data: {"steps":2,"model":"anthropic/claude-sonnet-5"}
```

Agents keep no memory between calls. Send the whole conversation each time, with the agent's last reply before your next message.

# Request body

| Field | Meaning |
|---|---|
| `agentKey` | A catalog agent; its servers, prompt and model are used |
| `servers` | Instead of an agent: 1 to 3 servers, each `{"server":"…","tools":["…"]}`, where `tools` is an optional allow-list |
| `messages` | 1 to 50 messages, oldest first, each `{"role":"user","content":"…"}` or with role `assistant`, up to 20,000 characters |
| `envs` | Keys by server: `{"<packageName>":{"NAME":"value"}}` |
| `model` | An OpenRouter model id, used when the agent doesn't set one |

Send `agentKey` or `servers`. A body that doesn't fit gets the JSON envelope with code 400 instead of a stream.

# Events

| Event | Data |
|---|---|
| `status` | `{message}`: progress, such as tools loading |
| `tool_call` | `{id, server, tool, args}` |
| `tool_result` | `{id, ok, ms, preview}`; the preview stops at 2,000 characters |
| `message` | `{content}`: the agent's reply |
| `error` | `{message}` |
| `done` | `{steps, model}`; every accepted chat ends with it |

# Limits

- **Steps.** Each model call is a step. Agents set their own limit from 1 to 10, 6 by default; chats with `servers` get 6. At the limit, a status event says so and the chat ends.
- **Tool output.** The model sees at most 20,000 characters of each tool result.
- **Model.** The agent's model wins, then the request's `model`, then the host's `OPENROUTER_MODEL`, then the built-in default.
- **Setup.** The host needs `OPENROUTER_API_KEY`. Without it, every chat ends with an error event saying agent chat isn't configured.
