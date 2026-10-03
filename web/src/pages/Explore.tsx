import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Layers,
  ScanSearch,
  Search,
  Server,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { getCategories, search } from "../lib/api";
import { categoryIcon } from "../lib/categories";
import { compact, cx, errorMessage, formatCount, isAbort, plural } from "../lib/format";
import { fromHit } from "../lib/items";
import { markStep } from "../lib/state";
import type { Runtime, SearchHit, SearchParams, SearchResult, SearchSort } from "../lib/types";
import { useAsync, useDebounced } from "../lib/useAsync";
import {
  Button,
  Empty,
  ErrorView,
  IconButton,
  Skeleton,
  Spinner,
  Tabs,
  type ToneName,
} from "../ui/core";
import { Checkbox, Field, Select, TextInput } from "../ui/form";
import { CardSkeletons, ItemCard } from "../ui/ItemCard";
import { Link } from "../wm/Link";
import { type ExploreType, paths } from "../wm/routes";
import { useRouteQuery, useWin, useWindowTitle } from "../wm/WindowManager";

const PAGE = 24;

const TYPES: {
  key: ExploreType;
  label: string;
  title: string;
  icon: LucideIcon;
  tone: ToneName;
  placeholder: string;
  lead: string;
}[] = [
  {
    key: "all",
    label: "All",
    title: "Explore",
    icon: Layers,
    tone: "blue",
    placeholder: "Search servers, tools and agents…",
    lead: "Every MCP server, tool and agent in the catalog. Search by name or by the job you need done, then open one to inspect, set up and try it.",
  },
  {
    key: "mcp",
    label: "MCP servers",
    title: "MCP servers",
    icon: Server,
    tone: "green",
    placeholder: "Search MCP servers…",
    lead: "Servers give an AI app new tools. Open one to add its keys, test its tools and connect it to your client.",
  },
  {
    key: "tool",
    label: "Tools",
    title: "Tools",
    icon: Wrench,
    tone: "teal",
    placeholder: "Search tools…",
    lead: "Single tools from every server. Open one to run it with your own input.",
  },
  {
    key: "agent",
    label: "Agents",
    title: "Agents",
    icon: Bot,
    tone: "purple",
    placeholder: "Search agents…",
    lead: "Agents you can chat with here, plus open-source agents from vendors and the community with what each needs and how to run it.",
  },
];

const RUNTIMES: { key: Runtime; label: string }[] = [
  { key: "node", label: "Node.js" },
  { key: "python", label: "Python" },
  { key: "go", label: "Go" },
  { key: "java", label: "Java" },
  { key: "docker", label: "Docker" },
];

const SORTS: { key: SearchSort; label: string }[] = [
  { key: "relevance", label: "Best match" },
  { key: "popularity:desc", label: "Most popular" },
  { key: "name:asc", label: "Name A–Z" },
];

const CATEGORY_SKELETONS = ["a", "b", "c", "d", "e", "f", "g", "h"];

interface Page {
  result: SearchResult;
  typeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
}

/**
 * First page of results plus facet counts. Each facet leaves out its own filter, so the other
 * options keep showing how many results they would give.
 */
async function loadPage(params: SearchParams, signal: AbortSignal): Promise<Page> {
  const [result, byType, byCategory] = await Promise.all([
    search({ ...params, limit: PAGE, facets: ["type", "category"] }, signal),
    params.type
      ? search({ ...params, type: undefined, limit: 0, facets: ["type"] }, signal)
      : undefined,
    params.category
      ? search({ ...params, category: undefined, limit: 0, facets: ["category"] }, signal)
      : undefined,
  ]);
  return {
    result,
    typeCounts: (byType ?? result).facetDistribution?.type ?? {},
    categoryCounts: (byCategory ?? result).facetDistribution?.category ?? {},
  };
}

/** Extra pages loaded with "Load more", for the search they belong to. */
interface More {
  key: string;
  hits: SearchHit[];
  loading: boolean;
  done: boolean;
  error?: unknown;
}

interface Chip {
  id: string;
  label: string;
  clear(): void;
}

const sum = (counts: Record<string, number>) =>
  Object.values(counts).reduce((total, count) => total + count, 0);

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    seen.add(hit.id);
    return true;
  });
}

/** Search and browse the whole catalog: /explore, /servers, /tools and /agents. */
export function Explore() {
  const win = useWin();
  const query = useRouteQuery();
  const type: ExploreType = win.route.params.type ?? "all";
  const meta = TYPES.find((item) => item.key === type) ?? TYPES[0];
  // The URL holds the search text and category, so links and Back/Forward restore them.
  const q = query.get("q") ?? "";
  const category = query.get("category") ?? "";
  useWindowTitle(meta.title);

  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [verified, setVerified] = useState(false);
  const [noKeys, setNoKeys] = useState(false);
  const [hideBlocked, setHideBlocked] = useState(false);
  const [runtime, setRuntime] = useState<Runtime | "">("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [more, setMore] = useState<More>();
  const moreAbort = useRef<AbortController | null>(null);

  const term = useDebounced(q.trim(), 200);
  const params: SearchParams = {
    q: term || undefined,
    type: type === "all" ? undefined : type,
    category: category || undefined,
    validated: verified || undefined,
    needsKeys: noKeys ? false : undefined,
    blocked: hideBlocked ? false : undefined,
    runtime: runtime || undefined,
    sort,
  };
  const paramsKey = JSON.stringify(params);

  const page = useAsync((signal) => loadPage(params, signal), [params], { keep: true });
  const categories = useAsync(() => getCategories(), []);

  useEffect(() => () => moreAbort.current?.abort(), []);

  const extra = more?.key === paramsKey ? more : undefined;
  const hits = page.data ? dedupe([...page.data.result.hits, ...(extra?.hits ?? [])]) : [];
  const total = page.data?.result.estimatedTotalHits ?? 0;
  const found = !page.loading && !page.error && hits.length > 0;

  useEffect(() => {
    if (found && (term || category)) markStep("discover");
  }, [found, term, category]);

  const go = (next: { type?: ExploreType; q?: string; category?: string }, replace = false) =>
    win.navigate(
      paths.explore({ type, q: q || undefined, category: category || undefined, ...next }),
      { replace },
    );

  const loadMore = async () => {
    if (!page.data || page.loading || extra?.loading) return;
    const key = paramsKey;
    const have = extra?.hits ?? [];
    const offset = page.data.result.hits.length + have.length;
    const abort = new AbortController();
    moreAbort.current = abort;
    setMore({ key, hits: have, loading: true, done: false });
    const update = (change: (prev: More) => More) =>
      setMore((prev) => (prev?.key === key ? change(prev) : prev));
    try {
      const next = await search({ ...params, limit: PAGE, offset }, abort.signal);
      update((prev) => ({
        ...prev,
        hits: [...prev.hits, ...next.hits],
        loading: false,
        done: next.hits.length < PAGE,
      }));
    } catch (err) {
      if (!isAbort(err)) update((prev) => ({ ...prev, loading: false, error: err }));
    }
  };

  const names = new Map((categories.data ?? []).map((item) => [item.key, item.name]));
  const categoryName = (key: string) => names.get(key) ?? key;
  const counts = page.data?.categoryCounts ?? {};
  const categoryRows = Object.entries(counts)
    .filter(([key, count]) => count > 0 || key === category)
    .map(([key, count]) => ({ key, count, name: categoryName(key) }));
  if (category && !(category in counts)) {
    categoryRows.push({ key: category, count: 0, name: categoryName(category) });
  }
  categoryRows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const chips: Chip[] = [];
  if (category) {
    chips.push({
      id: "category",
      label: categoryName(category),
      clear: () => go({ category: undefined }),
    });
  }
  if (verified) chips.push({ id: "verified", label: "Verified", clear: () => setVerified(false) });
  if (noKeys) chips.push({ id: "no-keys", label: "No keys needed", clear: () => setNoKeys(false) });
  if (hideBlocked) {
    chips.push({ id: "blocked", label: "Blocked hidden", clear: () => setHideBlocked(false) });
  }
  if (runtime) {
    chips.push({
      id: "runtime",
      label: RUNTIMES.find((item) => item.key === runtime)?.label ?? runtime,
      clear: () => setRuntime(""),
    });
  }

  const clearAll = () => {
    setVerified(false);
    setNoKeys(false);
    setHideBlocked(false);
    setRuntime("");
    if (category) go({ category: undefined });
  };

  const typeCounts = page.data?.typeCounts;
  const tabs = TYPES.map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    tone: item.tone,
    count: typeCounts && (item.key === "all" ? sum(typeCounts) : (typeCounts[item.key] ?? 0)),
  }));

  const canLoadMore = hits.length > 0 && hits.length < total && !extra?.done;

  let results: ReactNode;
  if (page.error) {
    results = <ErrorView title="Search failed" error={page.error} onRetry={page.reload} />;
  } else if (!page.data) {
    results = (
      <div className="card-grid">
        <CardSkeletons count={9} />
      </div>
    );
  } else if (!hits.length) {
    results = page.loading ? null : (
      <Empty
        icon={ScanSearch}
        title={term ? `No matches for “${term}”` : "Nothing here yet"}
        action={
          chips.length > 0 && (
            <Button icon={X} onClick={clearAll}>
              Clear filters
            </Button>
          )
        }
      >
        {chips.length
          ? "Try fewer words, or clear some filters."
          : "Try fewer or different words, or browse a category."}
      </Empty>
    );
  } else {
    results = (
      <div className={cx("card-grid", page.loading && "is-stale")}>
        {hits.map((hit) => (
          <ItemCard key={hit.id} item={fromHit(hit)} />
        ))}
      </div>
    );
  }

  return (
    <div className="page explore">
      <header className="page-head">
        <h1 className="page-title">{meta.title}</h1>
        <p className="page-lead">{meta.lead}</p>
      </header>

      <div className="explore-search">
        <TextInput
          ref={input}
          large
          icon={Search}
          type="search"
          aria-label="Search the catalog"
          placeholder={meta.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(event) => go({ q: event.target.value || undefined }, true)}
          end={
            q && (
              <IconButton
                icon={X}
                label="Clear search"
                size="sm"
                onClick={() => {
                  go({ q: undefined }, true);
                  input.current?.focus();
                }}
              />
            )
          }
        />
      </div>

      <Tabs<ExploreType>
        label="Item type"
        items={tabs}
        value={type}
        onChange={(key) => go({ type: key })}
      >
        <div className="explore-body">
          <aside id={`${id}-filters`} className={cx("explore-side", filtersOpen && "is-open")}>
            <section className="explore-group" aria-labelledby={`${id}-filters-title`}>
              <h2 id={`${id}-filters-title`} className="explore-group-title">
                Filters
              </h2>
              <Checkbox
                label="Verified only"
                hint="Started and listed its tools in our test run."
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              <Checkbox
                label="No keys needed"
                hint="Works without API keys."
                checked={noKeys}
                onChange={(event) => setNoKeys(event.target.checked)}
              />
              <Checkbox
                label="Hide blocked"
                hint="Blocked servers can't run here."
                checked={hideBlocked}
                onChange={(event) => setHideBlocked(event.target.checked)}
              />
              <Field label="Runtime" htmlFor={`${id}-runtime`}>
                <Select
                  id={`${id}-runtime`}
                  value={runtime}
                  onChange={(event) => setRuntime(event.target.value as Runtime | "")}
                >
                  <option value="">Any runtime</option>
                  {RUNTIMES.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </section>

            <nav className="explore-group" aria-labelledby={`${id}-categories-title`}>
              <h2 id={`${id}-categories-title`} className="explore-group-title">
                Categories
              </h2>
              <ul className="explore-cats">
                <li>
                  <Link
                    href={paths.explore({ type, q: q || undefined })}
                    className="explore-cat"
                    aria-current={category ? undefined : "true"}
                    onClick={() => setFiltersOpen(false)}
                  >
                    <Layers size={15} aria-hidden="true" />
                    <span className="truncate">All categories</span>
                    {page.data && <span className="explore-cat-count">{compact(sum(counts))}</span>}
                  </Link>
                </li>
                {page.data
                  ? categoryRows.map((row) => {
                      const Icon = categoryIcon(row.key);
                      return (
                        <li key={row.key}>
                          <Link
                            href={paths.explore({ type, q: q || undefined, category: row.key })}
                            className="explore-cat"
                            aria-current={row.key === category ? "true" : undefined}
                            onClick={() => setFiltersOpen(false)}
                          >
                            <Icon size={15} aria-hidden="true" />
                            <span className="truncate">{row.name}</span>
                            <span className="explore-cat-count">{compact(row.count)}</span>
                          </Link>
                        </li>
                      );
                    })
                  : CATEGORY_SKELETONS.map((key) => (
                      <li key={key} className="explore-cat" aria-hidden="true">
                        <Skeleton width={15} height={15} />
                        <Skeleton width="70%" />
                      </li>
                    ))}
              </ul>
            </nav>
          </aside>

          <section className="explore-main" aria-labelledby={`${id}-results-title`}>
            <h2 id={`${id}-results-title`} className="sr-only">
              Results
            </h2>
            <div className="explore-bar">
              <p className="explore-count" aria-live="polite">
                {page.data ? (
                  <>
                    {plural(total, "result")}
                    <span className="explore-time">
                      {page.data.result.processingTimeMs
                        ? `in ${formatCount(page.data.result.processingTimeMs)} ms`
                        : "in under 1 ms"}
                    </span>
                  </>
                ) : (
                  "Searching…"
                )}
                {page.loading && page.data && <Spinner label="Updating results" />}
              </p>
              <div className="explore-controls">
                <Select
                  aria-label="Sort results"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SearchSort)}
                >
                  {SORTS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  icon={SlidersHorizontal}
                  className="explore-filters-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls={`${id}-filters`}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  Filters{chips.length > 0 && ` (${chips.length})`}
                </Button>
              </div>
            </div>

            {chips.length > 0 && (
              <ul className="explore-chips" aria-label="Active filters">
                {chips.map((chip) => (
                  <li key={chip.id}>
                    <button
                      type="button"
                      className="explore-chip"
                      aria-label={`Remove filter: ${chip.label}`}
                      onClick={chip.clear}
                    >
                      {chip.label}
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {chips.length > 1 && (
                  <li>
                    <button type="button" className="explore-chip-clear" onClick={clearAll}>
                      Clear all
                    </button>
                  </li>
                )}
              </ul>
            )}

            {results}

            {page.data && !page.error && hits.length > 0 && (
              <div className="explore-more">
                <p className="explore-more-count">
                  Showing {formatCount(hits.length)} of {formatCount(total)}
                </p>
                {canLoadMore && (
                  <Button
                    onClick={() => void loadMore()}
                    loading={extra?.loading}
                    disabled={page.loading}
                  >
                    Load more
                  </Button>
                )}
                {extra?.error !== undefined && (
                  <p className="explore-more-error">
                    Couldn't load more: {errorMessage(extra.error)}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </Tabs>
    </div>
  );
}
