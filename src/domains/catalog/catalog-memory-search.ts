import { HIDDEN_DOC_FIELDS } from "./catalog-repository";
import type {
  IndexedDoc,
  SearchDoc,
  SearchHit,
  SearchParams,
  SearchResult,
  SearchSort,
} from "./catalog-types";

// Query semantics shared by both engines (memory and Meilisearch).

/** Filter params → indexed field. Exact match; array fields match any element. */
export const FILTER_FIELDS = {
  type: "type",
  category: "category",
  validated: "validated",
  blocked: "blocked",
  needsKeys: "fNeedsKeys",
  runtime: "fRuntime",
  server: "fServers",
} as const satisfies Partial<Record<keyof SearchParams, string>>;

/** Facet names clients may ask for → indexed field. Unknown names are ignored. */
export const FACET_FIELDS = new Map<string, string>([
  ["type", "type"],
  ["category", "category"],
  ["validated", "validated"],
  ["runtime", "fRuntime"],
  ["needsKeys", "fNeedsKeys"],
  ["blocked", "blocked"],
  ["remote", "remote"],
  ["tags", "tags"],
  ["author", "author"],
]);

export const DEFAULT_LIMIT = 20;

export type FilterValue = string | boolean;

export function searchFilters(params: SearchParams): [field: string, value: FilterValue][] {
  const filters: [string, FilterValue][] = [];
  for (const [param, field] of Object.entries(FILTER_FIELDS)) {
    const value = params[param as keyof typeof FILTER_FIELDS];
    if (value !== undefined && value !== "") filters.push([field, value]);
  }
  return filters;
}

/** Requested facet names that exist, deduplicated, in request order. */
export const requestedFacets = (names?: string[]) =>
  [...new Set(names ?? [])].filter((name) => FACET_FIELDS.has(name));

/** Relevance when there is a query, otherwise most popular first. */
export const resolveSort = (params: SearchParams): SearchSort =>
  params.sort ?? (params.q?.trim() ? "relevance" : "popularity:desc");

export function stripHiddenFields(doc: IndexedDoc): SearchDoc {
  const out: Record<string, unknown> = { ...doc };
  for (const field of HIDDEN_DOC_FIELDS) delete out[field];
  return out as unknown as SearchDoc;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Entry {
  doc: IndexedDoc;
  /** Lowercase searchable fields, joined; a token missing here cannot match. */
  haystack: string;
  fields: { value: string; weight: number }[];
  name: string;
}

function weightedFields(doc: IndexedDoc) {
  const d = doc as IndexedDoc & Partial<Record<"packageName" | "toolName" | "key", string>>;
  const serverName = doc.type === "tool" ? doc.serverName : undefined;
  const fields: [string | undefined, number][] = [
    [doc.name, 10],
    [d.packageName, 6],
    [d.toolName, 6],
    [d.key, 6],
    [doc.tags.join(" "), 4],
    [doc.description, 2],
    [serverName, 1],
    [doc.categoryName, 1],
    [doc.text, 1],
  ];
  return fields.flatMap(([value, weight]) =>
    value ? [{ value: value.toLowerCase(), weight }] : [],
  );
}

/**
 * Search without Meilisearch: every query token must appear (as a substring) in some searchable
 * field; the score adds each token's best field weight. Same params and result shape as the
 * Meilisearch engine.
 */
export class MemorySearchIndex {
  private readonly entries: Entry[];

  constructor(docs: IndexedDoc[]) {
    this.entries = docs.map((doc) => {
      const fields = weightedFields(doc);
      return {
        doc,
        fields,
        haystack: fields.map((f) => f.value).join("\n"),
        name: doc.name.toLowerCase(),
      };
    });
  }

  get size() {
    return this.entries.length;
  }

  search(params: SearchParams): Omit<SearchResult, "engine"> {
    const started = performance.now();
    const query = params.q?.trim() ?? "";
    const lowerQuery = query.toLowerCase();
    const tokens = lowerQuery.split(/\s+/).filter(Boolean);
    const filters = searchFilters(params);
    const limit = params.limit ?? DEFAULT_LIMIT;
    const offset = params.offset ?? 0;

    const matched: { entry: Entry; score: number }[] = [];
    for (const entry of this.entries) {
      if (!filters.every(([field, value]) => matchesFilter(entry.doc, field, value))) continue;
      const score = scoreEntry(entry, tokens, lowerQuery);
      if (score !== null) matched.push({ entry, score });
    }

    const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const byPopularity = (a: Entry, b: Entry) =>
      b.doc.popularity - a.doc.popularity || byName(a, b);
    const sort = resolveSort(params);
    matched.sort((a, b) => {
      if (sort === "name:asc") return byName(a.entry, b.entry);
      if (sort === "relevance") return b.score - a.score || byPopularity(a.entry, b.entry);
      return byPopularity(a.entry, b.entry);
    });

    const facets = requestedFacets(params.facets);
    let facetDistribution: SearchResult["facetDistribution"];
    if (facets.length) {
      facetDistribution = {};
      for (const name of facets) {
        facetDistribution[name] = countFacet(matched, FACET_FIELDS.get(name) as string);
      }
    }

    const highlight = tokens.length ? highlighter(tokens) : undefined;
    const hits = matched.slice(offset, offset + limit).map(({ entry }): SearchHit => {
      const hit: SearchHit = stripHiddenFields(entry.doc);
      if (highlight) {
        hit._formatted = {
          name: highlight(entry.doc.name),
          description: highlight(entry.doc.description),
        };
      }
      return hit;
    });

    return {
      hits,
      query,
      estimatedTotalHits: matched.length,
      limit,
      offset,
      processingTimeMs: Math.round(performance.now() - started),
      ...(facetDistribution ? { facetDistribution } : {}),
    };
  }
}

function matchesFilter(doc: IndexedDoc, field: string, value: FilterValue) {
  const actual = (doc as unknown as Record<string, unknown>)[field];
  return Array.isArray(actual) ? actual.includes(value) : actual === value;
}

/** null when some token matches no field. */
function scoreEntry(entry: Entry, tokens: string[], lowerQuery: string): number | null {
  let score = 0;
  for (const token of tokens) {
    if (!entry.haystack.includes(token)) return null;
    let best = 0;
    for (const field of entry.fields) {
      if (field.weight > best && field.value.includes(token)) best = field.weight;
    }
    score += best;
    if (entry.name.startsWith(token)) score += 5;
  }
  if (tokens.length && entry.name === lowerQuery) score += 20;
  return score;
}

function countFacet(matched: { entry: Entry }[], field: string) {
  const counts: Record<string, number> = {};
  for (const { entry } of matched) {
    const value = (entry.doc as unknown as Record<string, unknown>)[field];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null) continue;
      const key = String(v);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/** Wraps every occurrence of any token in <mark>, longest token first. */
function highlighter(tokens: string[]) {
  const pattern = [...new Set(tokens)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const regex = new RegExp(pattern, "gi");
  return (text: string) => text.replace(regex, "<mark>$&</mark>");
}
