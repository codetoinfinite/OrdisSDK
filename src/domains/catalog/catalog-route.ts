import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createRouteResponses, validationHook } from "../../shared/utils/response-util";
import { catalogHandler } from "./catalog-handler";
import {
  AgentDetailResponseSchema,
  AgentListResponseSchema,
  CatalogCategoriesResponseSchema,
  CatalogFeaturedResponseSchema,
  CatalogStatsResponseSchema,
  KeyQuerySchema,
  ServerDetailResponseSchema,
  ServerQuerySchema,
  ToolDetailResponseSchema,
  ToolListResponseSchema,
} from "./catalog-schema";

export const catalogRoutes = new OpenAPIHono({ defaultHook: validationHook });

const responses = (schema: Parameters<typeof createRouteResponses>[0]) =>
  createRouteResponses(schema, { includeErrorResponses: true });

const statsRoute = createRoute({
  method: "get",
  path: "/stats",
  summary: "Counts of servers, tools, agents and categories, plus the active search engine",
  responses: responses(CatalogStatsResponseSchema),
});

catalogRoutes.openapi(statsRoute, async (c) => c.json(await catalogHandler.stats(), 200));

const categoriesRoute = createRoute({
  method: "get",
  path: "/categories",
  summary: "Categories with item counts per type",
  responses: responses(CatalogCategoriesResponseSchema),
});

catalogRoutes.openapi(categoriesRoute, async (c) => c.json(await catalogHandler.categories(), 200));

const featuredRoute = createRoute({
  method: "get",
  path: "/featured",
  summary: "Featured servers, curated tools and agents",
  responses: responses(CatalogFeaturedResponseSchema),
});

catalogRoutes.openapi(featuredRoute, async (c) => c.json(await catalogHandler.featured(), 200));

const serverRoute = createRoute({
  method: "get",
  path: "/server",
  summary: "Server detail from the registry index (cached tools; nothing is started)",
  request: { query: ServerQuerySchema },
  responses: responses(ServerDetailResponseSchema),
});

catalogRoutes.openapi(serverRoute, async (c) => {
  const { packageName } = c.req.valid("query");
  return c.json(await catalogHandler.server(packageName), 200);
});

const agentsRoute = createRoute({
  method: "get",
  path: "/agents",
  summary: "All agents",
  responses: responses(AgentListResponseSchema),
});

catalogRoutes.openapi(agentsRoute, async (c) => c.json(await catalogHandler.agents(), 200));

const agentRoute = createRoute({
  method: "get",
  path: "/agent",
  summary: "Agent detail with resolved servers",
  request: { query: KeyQuerySchema },
  responses: responses(AgentDetailResponseSchema),
});

catalogRoutes.openapi(agentRoute, async (c) => {
  const { key } = c.req.valid("query");
  return c.json(await catalogHandler.agent(key), 200);
});

const toolsRoute = createRoute({
  method: "get",
  path: "/tools",
  summary: "Curated tools",
  responses: responses(ToolListResponseSchema),
});

catalogRoutes.openapi(toolsRoute, async (c) => c.json(await catalogHandler.tools(), 200));

const toolRoute = createRoute({
  method: "get",
  path: "/tool",
  summary: "Curated tool detail with its resolved server",
  request: { query: KeyQuerySchema },
  responses: responses(ToolDetailResponseSchema),
});

catalogRoutes.openapi(toolRoute, async (c) => {
  const { key } = c.req.valid("query");
  return c.json(await catalogHandler.tool(key), 200);
});
