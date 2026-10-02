import { z } from "@hono/zod-openapi";
import {
  BaseResponseSchema,
  MCPServerPackageConfigSchema,
} from "../../shared/schemas/common-schema";
import type { SearchParams } from "../catalog/catalog-types";

const ItemTypeSchema = z.enum(["mcp", "tool", "agent"]);
const EngineSchema = z.enum(["meilisearch", "memory"]);
const FlagSchema = z.enum(["true", "false"]);

export const searchQuerySchema = z.object({
  q: z.string().optional().openapi({
    description: "Search text; omit to browse",
    example: "database",
  }),
  type: ItemTypeSchema.optional().openapi({ description: "Item type" }),
  category: z.string().optional().openapi({
    description: "Category key",
    example: "databases",
  }),
  validated: FlagSchema.optional().openapi({ description: "Filter by validated status" }),
  runtime: MCPServerPackageConfigSchema.shape.runtime.optional().openapi({
    description: "Server runtime (tools inherit their server's; agents need a single runtime)",
  }),
  needsKeys: FlagSchema.optional().openapi({
    description: "Filter by whether a required env var without default must be supplied",
  }),
  blocked: FlagSchema.optional().openapi({
    description: "false hides blocked servers and the tools and agents that use them",
  }),
  server: z.string().optional().openapi({
    description: "Registry key of a server: the server, its tools and the agents that use it",
    example: "@modelcontextprotocol/server-everything",
  }),
  sort: z.enum(["relevance", "popularity:desc", "name:asc"]).optional().openapi({
    description: "Default: relevance with a query, popularity:desc without",
  }),
  limit: z.coerce.number().int().min(0).max(100).optional().openapi({
    description: "Page size (0 returns only counts and facets)",
    example: 20,
  }),
  offset: z.coerce.number().int().min(0).optional().openapi({
    description: "Offset for pagination",
    example: 0,
  }),
  facets: z
    .string()
    .optional()
    .openapi({
      description:
        "Comma-separated facet names: type, category, validated, runtime, needsKeys, blocked, " +
        "remote, tags, author",
      example: "type,category",
    }),
});

const flag = (value?: "true" | "false") => (value === undefined ? undefined : value === "true");

export function toSearchParams(query: z.infer<typeof searchQuerySchema>): SearchParams {
  const { validated, needsKeys, blocked, facets, ...rest } = query;
  return {
    ...rest,
    validated: flag(validated),
    needsKeys: flag(needsKeys),
    blocked: flag(blocked),
    facets: facets
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  };
}

export const searchHitSchema = z
  .object({
    id: z.string(),
    type: ItemTypeSchema,
    name: z.string(),
    description: z.string(),
    category: z.string(),
    categoryName: z.string(),
    tags: z.array(z.string()),
    validated: z.boolean(),
    blocked: z.boolean(),
    popularity: z.number(),
    _formatted: z
      .object({ name: z.string().optional(), description: z.string().optional() })
      .optional()
      .openapi({ description: "name and description with <mark> highlights (queries only)" }),
  })
  .passthrough()
  .openapi("SearchHit", {
    description:
      "Common fields. mcp adds packageName, runtime, toolCount, envCount, needsKeys, remote, " +
      "logo?, author?; tool adds server, serverName, toolName, curated, key?; agent adds key, " +
      "servers, runnable",
  });

export const searchResponseSchema = BaseResponseSchema.extend({
  data: z
    .object({
      hits: z.array(searchHitSchema),
      query: z.string(),
      estimatedTotalHits: z.number(),
      limit: z.number(),
      offset: z.number(),
      processingTimeMs: z.number(),
      facetDistribution: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      engine: EngineSchema,
    })
    .optional(),
}).openapi("SearchResponse");

export const suggestQuerySchema = z.object({
  q: z.string().optional().openapi({
    description: "Suggestion query",
    example: "data",
  }),
  limit: z.coerce.number().int().min(1).max(20).optional().openapi({
    description: "Limit the number of results",
    example: 8,
  }),
});

export const suggestResultSchema = z
  .object({
    id: z.string(),
    type: ItemTypeSchema,
    name: z.string(),
    category: z.string(),
    packageName: z.string().optional(),
    server: z.string().optional(),
    toolName: z.string().optional(),
    key: z.string().optional(),
  })
  .openapi("SuggestResult");

export const suggestResponseSchema = BaseResponseSchema.extend({
  data: z
    .object({
      suggestions: z.array(suggestResultSchema),
    })
    .optional(),
}).openapi("SuggestResponse");

export const facetsResponseSchema = BaseResponseSchema.extend({
  data: z
    .object({
      categories: z.record(z.string(), z.number()).optional(),
      authors: z.record(z.string(), z.number()).optional(),
      validated: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
}).openapi("FacetsResponse");

export const healthResponseSchema = BaseResponseSchema.extend({
  data: z
    .object({
      status: z.enum(["healthy", "unhealthy", "disabled"]),
      host: z.string(),
      initialized: z.boolean(),
      indexName: z.string(),
      documentCount: z.number(),
      engine: EngineSchema,
    })
    .optional(),
}).openapi("HealthResponse");

export const managementResponseSchema = BaseResponseSchema.extend({
  data: z
    .object({
      message: z.string(),
      details: z.any().optional(),
    })
    .optional(),
}).openapi("ManagementResponse");
