import { createErrorResponse, createResponse } from "../../shared/utils/response-util";
import { getSearchStatus } from "../search/search-handler";
import { getCatalog, toAgentSummary, toToolSummary } from "./catalog-repository";
import type { CatalogStats } from "./catalog-types";

const found = <T>(item: T | undefined, notFound: string) =>
  item ? createResponse(item) : createErrorResponse(notFound, 404);

/** Reads only the loaded catalog: no process is started. */
export const catalogHandler = {
  stats: async () => {
    const catalog = await getCatalog();
    const stats: CatalogStats = { ...catalog.stats, search: getSearchStatus(catalog) };
    return createResponse(stats);
  },

  categories: async () => createResponse((await getCatalog()).categories),

  featured: async () => createResponse((await getCatalog()).featured),

  server: async (packageName: string) =>
    found((await getCatalog()).server(packageName), `Server '${packageName}' not found`),

  agents: async () => createResponse((await getCatalog()).agents.map(toAgentSummary)),

  agent: async (key: string) => found((await getCatalog()).agent(key), `Agent '${key}' not found`),

  tools: async () => createResponse((await getCatalog()).tools.map(toToolSummary)),

  tool: async (key: string) => found((await getCatalog()).tool(key), `Tool '${key}' not found`),
};
