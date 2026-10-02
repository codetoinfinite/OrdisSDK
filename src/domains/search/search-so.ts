import { MeiliSearch, type SearchParams as MeiliSearchParams, type Settings } from "meilisearch";
import { getMeiliSearchConfig } from "../../shared/config/environment";
import { withTimeout } from "../../shared/utils/promise-util";
import {
  DEFAULT_LIMIT,
  FACET_FIELDS,
  requestedFacets,
  resolveSort,
  searchFilters,
} from "../catalog/catalog-memory-search";
import type {
  IndexedDoc,
  SearchHit,
  SearchParams,
  SearchResult,
  SearchSort,
} from "../catalog/catalog-types";

export const SEARCH_INDEX_NAME = "alphesdk-catalog";

const REQUEST_TIMEOUT_MS = 3000;
const TASK_TIMEOUT_MS = 120_000;
const BATCH_SIZE = 5000;

const SORTS: Record<SearchSort, string[] | undefined> = {
  relevance: undefined,
  "popularity:desc": ["popularity:desc", "name:asc"],
  "name:asc": ["name:asc"],
};

/**
 * Fields returned in hits: the contract fields of all three document types. The rest of
 * IndexedDoc (HIDDEN_DOC_FIELDS) is only searched and filtered on.
 */
export const DISPLAYED_ATTRIBUTES = [
  "id",
  "type",
  "name",
  "description",
  "category",
  "categoryName",
  "tags",
  "validated",
  "blocked",
  "popularity",
  "packageName",
  "runtime",
  "toolCount",
  "envCount",
  "needsKeys",
  "remote",
  "logo",
  "author",
  "server",
  "serverName",
  "toolName",
  "curated",
  "key",
  "servers",
  "runnable",
];

export const INDEX_SETTINGS: Settings = {
  searchableAttributes: [
    "name",
    "packageName",
    "toolName",
    "key",
    "tags",
    "description",
    "serverName",
    "categoryName",
    "text",
  ],
  displayedAttributes: DISPLAYED_ATTRIBUTES,
  filterableAttributes: [
    "type",
    "category",
    "validated",
    "blocked",
    "remote",
    "curated",
    "runnable",
    "tags",
    "author",
    "fNeedsKeys",
    "fRuntime",
    "fServers",
  ],
  sortableAttributes: ["popularity", "name"],
  // "sort" first: an explicit sort orders all hits; without one, relevance decides.
  rankingRules: ["sort", "words", "typo", "proximity", "attribute", "exactness", "popularity:desc"],
  synonyms: {
    ai: ["artificial intelligence", "machine learning", "ml"],
    db: ["database"],
    api: ["rest", "graphql"],
    auth: ["authentication", "authorization"],
    mcp: ["model context protocol"],
  },
  faceting: { maxValuesPerFacet: 200 },
  pagination: { maxTotalHits: 20_000 },
};

/** Meilisearch engine of the unified catalog search. */
export class SearchSO {
  private readonly client: MeiliSearch;

  constructor(
    readonly host: string,
    apiKey?: string,
    readonly indexName = SEARCH_INDEX_NAME,
  ) {
    this.client = new MeiliSearch({ host, apiKey });
  }

  static create(): SearchSO {
    const { host, apiKey } = getMeiliSearchConfig();
    return new SearchSO(host, apiKey ?? undefined);
  }

  private get index() {
    return this.client.index<IndexedDoc>(this.indexName);
  }

  private async wait(taskUid: number, what: string) {
    const task = await this.client.waitForTask(taskUid, {
      timeOutMs: TASK_TIMEOUT_MS,
      intervalMs: 100,
    });
    if ((task.status as string) === "failed") {
      throw new Error(`Meilisearch could not ${what}: ${task.error?.message ?? "unknown error"}`);
    }
  }

  private async ensureIndex() {
    const { taskUid } = await this.client.createIndex(this.indexName, { primaryKey: "id" });
    const task = await this.client.waitForTask(taskUid, { timeOutMs: TASK_TIMEOUT_MS });
    if ((task.status as string) === "failed" && task.error?.code !== "index_already_exists") {
      throw new Error(`Meilisearch could not create the index: ${task.error?.message}`);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await withTimeout(REQUEST_TIMEOUT_MS, this.client.health());
      return true;
    } catch {
      return false;
    }
  }

  /** Replaces the whole index with `docs` and applies INDEX_SETTINGS. Returns the stored count. */
  async replaceDocuments(docs: IndexedDoc[]): Promise<number> {
    await withTimeout(REQUEST_TIMEOUT_MS, this.client.health());
    await this.ensureIndex();
    const index = this.index;
    await this.wait((await index.deleteAllDocuments()).taskUid, "delete the old documents");
    await this.wait((await index.updateSettings(INDEX_SETTINGS)).taskUid, "update the settings");
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const { taskUid } = await index.addDocuments(docs.slice(i, i + BATCH_SIZE), {
        primaryKey: "id",
      });
      await this.wait(taskUid, "add documents");
    }
    return (await index.getStats()).numberOfDocuments;
  }

  async search(params: SearchParams): Promise<Omit<SearchResult, "engine">> {
    const query = params.q?.trim() ?? "";
    const filter = searchFilters(params).map(
      ([field, value]) => `${field} = ${JSON.stringify(value)}`,
    );
    const facets = requestedFacets(params.facets);
    const limit = params.limit ?? DEFAULT_LIMIT;
    const offset = params.offset ?? 0;

    const options: MeiliSearchParams = {
      limit,
      offset,
      filter: filter.length ? filter : undefined,
      sort: SORTS[resolveSort(params)],
      facets: facets.length ? facets.map((name) => FACET_FIELDS.get(name) as string) : undefined,
      matchingStrategy: "all",
      ...(query
        ? {
            attributesToHighlight: ["name", "description"],
            highlightPreTag: "<mark>",
            highlightPostTag: "</mark>",
          }
        : {}),
    };
    const response = await this.index.search(query, options, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const hits = response.hits.map(({ _formatted, ...doc }) => {
      const hit = doc as unknown as SearchHit;
      if (query && _formatted) {
        hit._formatted = {
          name: String(_formatted.name ?? doc.name),
          description: String(_formatted.description ?? doc.description),
        };
      }
      return hit;
    });

    let facetDistribution: SearchResult["facetDistribution"];
    if (facets.length) {
      facetDistribution = {};
      for (const name of facets) {
        facetDistribution[name] =
          response.facetDistribution?.[FACET_FIELDS.get(name) as string] ?? {};
      }
    }

    return {
      hits,
      query,
      estimatedTotalHits: response.estimatedTotalHits ?? hits.length,
      limit,
      offset,
      processingTimeMs: response.processingTimeMs,
      ...(facetDistribution ? { facetDistribution } : {}),
    };
  }

  async stats() {
    const stats = await withTimeout(REQUEST_TIMEOUT_MS, this.index.getStats());
    return {
      host: this.host,
      indexName: this.indexName,
      documents: stats.numberOfDocuments,
      isIndexing: stats.isIndexing,
      fieldDistribution: stats.fieldDistribution,
    };
  }

  async clear() {
    await this.wait((await this.index.deleteAllDocuments()).taskUid, "delete the documents");
  }
}
