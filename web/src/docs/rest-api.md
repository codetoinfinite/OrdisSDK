Everything this app does goes through a plain HTTP API, so you can search the catalog and run tools from any language.

# Basics

- Base URL: `{{origin}}/api/v1`
- Interactive reference: [Swagger UI]({{origin}}/swagger), with the OpenAPI document at `{{origin}}/api/v1/doc`.
- JSON responses share one envelope:

```json
{ "success": true, "code": 200, "message": "Success", "data": {} }
```

A missing item comes back as HTTP 200 with `"success": false` and `"code": 404`, so check `success` rather than the HTTP status. An unknown route is a real HTTP 404.

# Search

```bash
curl -s "{{origin}}/api/v1/search?q=weather&type=tool&limit=5"
```

| Parameter | Meaning |
|---|---|
| `q` | Search text |
| `type` | `mcp`, `tool` or `agent` |
| `category` | A category key from `/catalog/categories` |
| `runtime` | A runtime such as `node` or `python` |
| `validated`, `needsKeys`, `blocked` | `true` or `false` |
| `sort` | `relevance`, `popularity:desc` or `name:asc` |
| `limit`, `offset` | Paging; `limit` is at most 100 |

Results are in `data.hits`, with the total in `data.estimatedTotalHits`. Matched words are wrapped in `<mark>` in each hit's `_formatted` fields. For search as you type, use `GET /search/suggest?q=…`.

# Catalog

| Endpoint | Returns |
|---|---|
| `GET /catalog/stats` | Counts of servers, tools, agents and categories |
| `GET /catalog/categories` | Every category with its counts |
| `GET /catalog/featured` | The picks shown on Home |
| `GET /catalog/server?packageName=…` | One server with its tools, keys and status |
| `GET /catalog/tools` | Curated tools |
| `GET /catalog/tool?key=…` | One curated tool |
| `GET /catalog/agents` | Every agent |
| `GET /catalog/agent?key=…` | One agent and the servers it uses |

# Run a tool

`POST /packages/run` starts the server if needed, calls one tool and returns the result.

```bash
curl -s -X POST {{origin}}/api/v1/packages/run \
  -H "Content-Type: application/json" \
  -d '{"packageName":"@modelcontextprotocol/server-everything","toolKey":"echo","inputData":{"message":"hello"}}'
```

```json
{"success":true,"code":200,"message":"Success","data":{"content":[{"type":"text","text":"Echo: hello"}]}}
```

| Field | Meaning |
|---|---|
| `packageName` | The server's package name |
| `toolKey` | The tool's name as the server lists it |
| `inputData` | The tool's arguments |
| `envs` | Optional keys, such as `{"GITHUB_PERSONAL_ACCESS_TOKEN":"…"}` |

To see a server's tools and their input schemas first, call `GET /packages/tools?packageName=…`.
