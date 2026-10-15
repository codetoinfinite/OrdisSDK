import { describe, expect, it } from "vitest";
import { toSearchParams } from "../../search/search-schema";
import { MemorySearchIndex, requestedFacets, resolveSort } from "../catalog-memory-search";
import { Catalog, HIDDEN_DOC_FIELDS } from "../catalog-repository";
import type { SearchParams } from "../catalog-types";
import { catalogInput } from "./catalog-fixture";

describe("MemorySearchIndex", () => {
  const index = new MemorySearchIndex(new Catalog(catalogInput()).docs);
  const names = (params: SearchParams) => index.search(params).hits.map((h) => h.name);

  it("indexes all servers, tools and agents", () => {
    expect(index.size).toBe(10);
  });

  it("browses by popularity without a query, then by name", () => {
    const result = index.search({});
    expect(result.hits.map((h) => h.name)).toEqual([
      "Math helper",
      "Math Server",
      "Broken agent",
      "Blocked Server",
      "Remote Server",
    ]);
    expect(result).toMatchObject({ query: "", estimatedTotalHits: 5, limit: 20, offset: 0 });
    expect(result).not.toHaveProperty("facetDistribution");
    expect(result.hits[0]).not.toHaveProperty("_formatted");
  });

  it("leaves tools out unless the type asks for them", () => {
    expect(names({ q: "add" })).toEqual(["Math Server", "Math helper", "Blocked Server"]);
    expect(names({ q: "add", type: "tool" })).toEqual(["Add numbers", "Blocked add"]);
    expect(names({ type: "tool", sort: "name:asc" })).toEqual([
      "Add numbers",
      "Blocked add",
      "Divide",
      "echo",
      "Ghost",
    ]);
  });

  it("requires every token and ranks name matches first", () => {
    expect(names({ q: "math add" })).toEqual(["Math Server", "Math helper"]);
    expect(names({ q: "math add", type: "tool" })).toEqual(["Add numbers"]);
    expect(names({ q: "echo" })).toEqual(["Math Server"]);
    expect(names({ q: "zzz" })).toEqual([]);
    expect(names({ q: "c++ (" })).toEqual([]);
  });

  it("highlights query tokens in name and description", () => {
    const [hit] = index.search({ q: "  ADD  ", type: "tool" }).hits;
    expect(hit._formatted).toEqual({
      name: "<mark>Add</mark> numbers",
      description: "<mark>Add</mark>s two numbers",
    });
    expect(index.search({ q: "math add" }).hits[0]._formatted?.name).toBe(
      "<mark>Math</mark> Server",
    );
  });

  it("filters by type, server, blocked, needsKeys and runtime", () => {
    expect(names({ type: "tool", server: "srv-math", sort: "name:asc" })).toEqual([
      "Add numbers",
      "Divide",
      "echo",
    ]);
    expect(names({ type: "agent", server: "srv-blocked" })).toEqual(["Broken agent"]);
    expect(names({ blocked: false })).toEqual(["Math helper", "Math Server", "Remote Server"]);
    expect(names({ needsKeys: true })).toEqual(["Remote Server"]);
    expect(names({ runtime: "python" })).toEqual(["Remote Server"]);
    expect(names({ category: "other", type: "mcp" })).toEqual(["Remote Server"]);
    expect(names({ validated: true, type: "tool", sort: "name:asc" })).toEqual([
      "Add numbers",
      "Divide",
      "echo",
    ]);
  });

  it("counts requested facets over the filtered hits", () => {
    const all = index.search({
      facets: ["type", "category", "tags", "runtime", "author", "nope", "type"],
    });
    expect(all.facetDistribution).toEqual({
      type: { mcp: 3, agent: 2 },
      category: { dev: 3, other: 2 },
      tags: { math: 1 },
      runtime: { node: 4, python: 1 },
      author: { acme: 1 },
    });
    expect(index.search({ type: "tool", facets: ["category"] }).facetDistribution).toEqual({
      category: { dev: 4, other: 1 },
    });
  });

  it("pages with limit and offset", () => {
    const page = index.search({ limit: 2, offset: 1 });
    expect(page.hits.map((h) => h.name)).toEqual(["Math Server", "Broken agent"]);
    expect(page).toMatchObject({ estimatedTotalHits: 5, limit: 2, offset: 1 });
    const counts = index.search({ limit: 0, facets: ["type"] });
    expect(counts.hits).toEqual([]);
    expect(counts.estimatedTotalHits).toBe(5);
  });

  it("never returns the hidden index fields", () => {
    for (const hit of index.search({ limit: 100 }).hits) {
      for (const field of HIDDEN_DOC_FIELDS) expect(hit).not.toHaveProperty(field);
    }
    const [agent] = index.search({ type: "agent", q: "math" }).hits;
    expect(agent).toMatchObject({ key: "math-helper", servers: ["srv-math"], runnable: true });
  });
});

describe("search params", () => {
  it("defaults the sort to relevance only with a query", () => {
    expect(resolveSort({ q: "x" })).toBe("relevance");
    expect(resolveSort({ q: "  " })).toBe("popularity:desc");
    expect(resolveSort({ q: "x", sort: "name:asc" })).toBe("name:asc");
  });

  it("keeps known facet names once, in request order", () => {
    expect(requestedFacets(["tags", "nope", "type", "tags"])).toEqual(["tags", "type"]);
    expect(requestedFacets()).toEqual([]);
  });

  it("maps query strings to search params", () => {
    expect(
      toSearchParams({
        q: "db",
        validated: "true",
        needsKeys: "false",
        facets: " type, ,category ",
        limit: 5,
      }),
    ).toEqual({
      q: "db",
      validated: true,
      needsKeys: false,
      blocked: undefined,
      facets: ["type", "category"],
      limit: 5,
    });
    expect(toSearchParams({ blocked: "false" }).blocked).toBe(false);
    expect(toSearchParams({}).facets).toBeUndefined();
  });
});
