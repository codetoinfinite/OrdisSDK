import { isSearchEnabled } from "../../shared/config/environment";
import { createErrorResponse, createResponse } from "../../shared/utils/response-util";
import { MemorySearchIndex } from "../catalog/catalog-memory-search";
import { type Catalog, getCatalog, reloadCatalog } from "../catalog/catalog-repository";
import type {
  CatalogStats,
  SearchEngine,
  SearchHit,
  SearchParams,
  SearchResult,
  Suggestion,
} from "../catalog/catalog-types";
import { SEARCH_INDEX_NAME, SearchSO } from "./search-so";

/** After a Meilisearch error, the in-memory index answers for this long before a retry. */
const MEILI_RETRY_MS = 30_000;

let memory: { catalog: Catalog; index: MemorySearchIndex } | null = null;
let meili: SearchSO | null = null;
/** The catalog whose documents Meilisearch holds; null until indexed and while reindexing. */
let meiliCatalog: Catalog | null = null;
let meiliRetryAt = 0;
let indexQueue: Promise<unknown> = Promise.resolve();

async function memoryIndex() {
  const catalog = await getCatalog();
  if (memory?.catalog !== catalog) memory = { catalog, index: new MemorySearchIndex(catalog.docs) };
  return memory;
}

const activeEngine = (): SearchEngine =>
  meili && meiliCatalog && Date.now() >= meiliRetryAt ? "meilisearch" : "memory";

/** Unified search: Meilisearch when it is indexed and answering, otherwise the in-memory index. */
export async function searchCatalog(params: SearchParams): Promise<SearchResult> {
  if (meili && activeEngine() === "meilisearch") {
    try {
      return { ...(await meili.search(params)), engine: "meilisearch" };
    } catch (error) {
      meiliRetryAt = Date.now() + MEILI_RETRY_MS;
      console.warn(
        `[Search] Meilisearch failed, searching in memory for ${MEILI_RETRY_MS / 1000}s: ` +
          (error as Error).message,
      );
    }
  }
  const { index } = await memoryIndex();
  return { ...index.search(params), engine: "memory" };
}

/** (Re)indexes the current catalog into Meilisearch. Runs one at a time; memory answers meanwhile. */
function indexMeili(): Promise<number> {
  const run = indexQueue.then(async () => {
    const catalog = await getCatalog();
    const so = meili ?? SearchSO.create();
    meiliCatalog = null;
    const started = Date.now();
    const documents = await so.replaceDocuments(catalog.docs);
    meili = so;
    meiliCatalog = catalog;
    meiliRetryAt = 0;
    console.log(
      `[Search] Indexed ${documents} documents into Meilisearch '${so.indexName}' ` +
        `(${Date.now() - started}ms)`,
    );
    return documents;
  });
  indexQueue = run.catch(() => undefined);
  return run;
}

/** Startup: builds the in-memory index, then fills Meilisearch in the background if enabled. */
export function startSearch() {
  memoryIndex().catch((error: Error) => {
    console.error(`[Search] Could not load the catalog: ${error.message}`);
  });
  if (!isSearchEnabled()) return;
  indexMeili().catch((error: Error) => {
    console.warn(`[Search] Meilisearch unavailable, searching in memory: ${error.message}`);
  });
}

export const getSearchStatus = (): CatalogStats["search"] => ({ engine: activeEngine() });

function toSuggestion(hit: SearchHit): Suggestion {
  const base = { id: hit.id, type: hit.type, name: hit.name, category: hit.category };
  if (hit.type === "mcp") return { ...base, packageName: hit.packageName };
  if (hit.type === "agent") return { ...base, key: hit.key };
  return {
    ...base,
    server: hit.server,
    toolName: hit.toolName,
    ...(hit.key ? { key: hit.key } : {}),
  };
}

const failure = (what: string, error: unknown, code = 500) => {
  const message = (error as Error).message || String(error);
  console.error(`[Search] ${what} failed: ${message}`);
  return createErrorResponse(`${what} failed: ${message}`, code);
};

export const searchHandler = {
  search: async (params: SearchParams) => {
    try {
      return createResponse(await searchCatalog(params));
    } catch (error) {
      return failure("Search", error);
    }
  },

  suggest: async (q = "", limit = 8) => {
    try {
      if (!q.trim()) return createResponse({ suggestions: [] as Suggestion[] });
      const result = await searchCatalog({ q, limit, blocked: false, sort: "relevance" });
      return createResponse({ suggestions: result.hits.map(toSuggestion) });
    } catch (error) {
      return failure("Suggest", error);
    }
  },

  /** Legacy: facet counts of MCP servers. */
  getFacets: async () => {
    try {
      const { facetDistribution: facets = {} } = await searchCatalog({
        type: "mcp",
        limit: 0,
        facets: ["category", "author", "validated"],
      });
      return createResponse({
        categories: facets.category,
        authors: facets.author,
        validated: facets.validated,
      });
    } catch (error) {
      return failure("Facets", error);
    }
  },

  healthCheck: async () => {
    const enabled = isSearchEnabled();
    const so = meili ?? (enabled ? SearchSO.create() : null);
    const healthy = so ? await so.healthy() : false;
    let documentCount = 0;
    if (healthy && so)
      documentCount = await so.stats().then(
        (s) => s.documents,
        () => 0,
      );
    return createResponse({
      status: !enabled ? "disabled" : healthy ? "healthy" : "unhealthy",
      host: so?.host ?? "",
      initialized: meiliCatalog !== null,
      indexName: so?.indexName ?? SEARCH_INDEX_NAME,
      documentCount,
      engine: activeEngine(),
    });
  },

  initialize: async () => {
    if (!isSearchEnabled()) {
      return createErrorResponse(
        "Meilisearch is disabled (ENABLE_SEARCH is not 'true'); search runs in memory",
        400,
      );
    }
    try {
      const documents = await indexMeili();
      return createResponse({
        message: `Meilisearch ready with ${documents} documents`,
        details: { engine: activeEngine(), indexName: SEARCH_INDEX_NAME, documents },
      });
    } catch (error) {
      return failure("Meilisearch indexing", error);
    }
  },

  /** Reloads agents/, tools/ and the registry index, then reindexes every engine. */
  indexPackages: async () => {
    try {
      const catalog = await reloadCatalog();
      await memoryIndex();
      let meiliError: string | undefined;
      if (isSearchEnabled()) {
        await indexMeili().catch((error: Error) => {
          meiliError = error.message;
          console.warn(`[Search] Meilisearch indexing failed: ${error.message}`);
        });
      }
      const byType = { mcp: 0, tool: 0, agent: 0 };
      for (const doc of catalog.docs) byType[doc.type]++;
      return createResponse({
        message: `Indexed ${catalog.docs.length} documents`,
        details: {
          engine: activeEngine(),
          documents: catalog.docs.length,
          byType,
          skipped: catalog.errors,
          ...(meiliError ? { meiliError } : {}),
        },
      });
    } catch (error) {
      return failure("Indexing", error);
    }
  },

  clearIndex: async () => {
    if (!meili) return createErrorResponse("Meilisearch is not initialized", 400);
    try {
      meiliCatalog = null;
      await meili.clear();
      return createResponse({ message: "Meilisearch index cleared; search runs in memory" });
    } catch (error) {
      return failure("Clearing the index", error);
    }
  },

  getStats: async () => {
    if (!meili) return createErrorResponse("Meilisearch is not initialized", 400);
    try {
      return createResponse({
        message: "Index statistics retrieved successfully",
        details: { ...(await meili.stats()), engine: activeEngine() },
      });
    } catch (error) {
      return failure("Index statistics", error);
    }
  },
};
