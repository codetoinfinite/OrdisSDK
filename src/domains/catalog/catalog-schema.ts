import { z } from "@hono/zod-openapi";
import { BaseResponseSchema } from "../../shared/schemas/common-schema";

/** Keys of curated tools and agents: lowercase kebab-case, equal to the file name. */
export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KeySchema = z.string().regex(KEY_PATTERN, "key must be lowercase kebab-case");
const TextSchema = z.string().trim().min(1);

/** tools/<category>/<key>.json: a named entry point to one MCP tool. */
export const ToolFileSchema = z
  .object({
    type: z.literal("tool"),
    key: KeySchema,
    name: TextSchema,
    description: TextSchema,
    category: TextSchema,
    tags: z.array(TextSchema).default([]),
    mcp: z
      .object({
        server: TextSchema.describe("Registry key of the MCP server (packages-list.json)"),
        tool: TextSchema.describe("Tool name as the server lists it"),
      })
      .strict(),
  })
  .strict();

export const AgentServerRefSchema = z
  .object({
    server: TextSchema.describe("Registry key of the MCP server (packages-list.json)"),
    tools: z
      .array(TextSchema)
      .min(1)
      .optional()
      .describe("Allow-list of tool names; omit to allow every tool of the server"),
  })
  .strict();

/** agents/<category>/<key>.json: a prompt plus the servers it may use. */
export const AgentFileSchema = z
  .object({
    type: z.literal("agent"),
    key: KeySchema,
    name: TextSchema,
    description: TextSchema,
    category: TextSchema,
    tags: z.array(TextSchema).default([]),
    author: TextSchema.optional(),
    model: TextSchema.optional().describe("OpenRouter model id; defaults to OPENROUTER_MODEL"),
    systemPrompt: TextSchema,
    servers: z
      .array(AgentServerRefSchema)
      .min(1)
      .max(5)
      .refine((refs) => new Set(refs.map((r) => r.server)).size === refs.length, {
        message: "each server may be listed only once",
      }),
    starterPrompts: z.array(TextSchema).default([]),
    maxSteps: z.number().int().min(1).max(10).default(6),
  })
  .strict();

/** Only github.com repositories, so links and metadata lookups stay on one trusted host. */
export const GITHUB_REPO_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), "must be an https URL");
const StepsSchema = z.array(TextSchema).default([]);

export const ExternalRequirementSchema = z
  .object({
    name: TextSchema,
    kind: z.enum(["api-key", "runtime", "service", "hardware", "account"]),
    required: z.boolean().default(true),
    description: TextSchema.optional(),
  })
  .strict();

/**
 * agents/<category>/<key>.json: an open-source agent that lives in its own repository. The
 * catalog documents it (what it does, what it needs, how to run it); it is not run here.
 */
export const ExternalAgentFileSchema = z
  .object({
    type: z.literal("external-agent"),
    key: KeySchema,
    name: TextSchema,
    description: TextSchema,
    category: TextSchema,
    tags: z.array(TextSchema).default([]),
    repo: z.string().regex(GITHUB_REPO_PATTERN, "repo must be https://github.com/<owner>/<name>"),
    subpath: TextSchema.optional().describe("Folder inside the repository, for monorepos"),
    homepage: HttpsUrlSchema.optional(),
    docs: HttpsUrlSchema.optional(),
    publisher: TextSchema,
    publisherType: z.enum(["company", "community", "individual"]),
    official: z.boolean().describe("Published by the organisation that owns the product"),
    whatItDoes: TextSchema,
    howItWorks: TextSchema,
    requirements: z.array(ExternalRequirementSchema).default([]),
    install: StepsSchema,
    run: StepsSchema,
    interfaces: z.array(TextSchema).default([]),
    language: TextSchema.optional(),
    framework: TextSchema.optional(),
    models: TextSchema.optional().describe("Model providers the agent can use"),
    mcp: z.enum(["client", "server", "both", "none"]).default("none"),
    /** Repository facts from the GitHub API, as of checkedAt. */
    github: z
      .object({
        stars: z.number().int().min(0),
        license: TextSchema.optional(),
        pushedAt: TextSchema,
        checkedAt: TextSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const AnyAgentFileSchema = z.discriminatedUnion("type", [
  AgentFileSchema,
  ExternalAgentFileSchema,
]);

export const ServerQuerySchema = z.object({
  packageName: z
    .string()
    .min(1)
    .openapi({
      param: { name: "packageName", in: "query" },
      example: "@modelcontextprotocol/server-everything",
    }),
});

export const KeyQuerySchema = z.object({
  key: z
    .string()
    .min(1)
    .openapi({ param: { name: "key", in: "query" }, example: "everything-tester" }),
});

/** Envelope with loosely typed data; the exact shapes are in catalog-types.ts. */
const envelope = (name: string) =>
  BaseResponseSchema.extend({ data: z.any().optional() }).openapi(name);

export const CatalogStatsResponseSchema = envelope("CatalogStatsResponse");
export const CatalogCategoriesResponseSchema = envelope("CatalogCategoriesResponse");
export const CatalogFeaturedResponseSchema = envelope("CatalogFeaturedResponse");
export const ServerDetailResponseSchema = envelope("CatalogServerDetailResponse");
export const AgentListResponseSchema = envelope("CatalogAgentListResponse");
export const AgentDetailResponseSchema = envelope("CatalogAgentDetailResponse");
export const ToolListResponseSchema = envelope("CatalogToolListResponse");
export const ToolDetailResponseSchema = envelope("CatalogToolDetailResponse");
