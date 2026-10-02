import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bot, Check, CircleCheck, FlaskConical, Plug, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { getCategories, getFeatured, getStats } from "../lib/api";
import { categoryIcon } from "../lib/categories";
import { API_ORIGIN, STARTER_AGENT, STARTER_SERVER } from "../lib/config";
import { FLOW } from "../lib/flow";
import { cx, formatCount } from "../lib/format";
import type { Lang } from "../lib/highlight";
import { type CardItem, fromAgent, fromServer, fromTool } from "../lib/items";
import { buildSnippet, gatewayUrl } from "../lib/snippets";
import { useProgress } from "../lib/state";
import type { FeaturedCatalog } from "../lib/types";
import { type AsyncState, useAsync } from "../lib/useAsync";
import { CodeBlock } from "../ui/CodeBlock";
import { ButtonLink, ErrorView, Section, Skeleton, Tabs, type ToneName } from "../ui/core";
import { TextInput } from "../ui/form";
import { CardSkeletons, ItemCard } from "../ui/ItemCard";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";
import { useWin, useWindowTitle } from "../wm/WindowManager";

type PanelKey = "find" | "test" | "connect" | "run";

interface Panel {
  key: PanelKey;
  label: string;
  icon: LucideIcon;
  tone: ToneName;
  title: string;
  text: string;
  points: string[];
  cta: { label: string; href: string };
  code: { lang: Lang; title: string; text: string };
}

const CONNECT_SNIPPET = buildSnippet(
  "claude-code",
  [
    {
      name: "everything",
      packageName: STARTER_SERVER,
      url: gatewayUrl(`/mcp/${STARTER_SERVER}`),
      env: {},
      values: {},
    },
  ],
  { includeSecrets: false, desktopMode: "gateway" },
);

const PANELS: Panel[] = [
  {
    key: "find",
    label: "Find",
    icon: Search,
    tone: "blue",
    title: "Search thousands of MCP servers by what they do",
    text: "One index covers servers, the tools inside them and ready-made agents.",
    points: [
      "Typo-tolerant search with highlighted matches",
      "Filter by category, runtime, verification and keys",
      "Blocked or broken servers are flagged, not hidden",
    ],
    cta: { label: "Start searching", href: paths.explore() },
    code: {
      lang: "bash",
      title: "Search API",
      text: `curl "${API_ORIGIN}/api/v1/search?q=weather&type=mcp&limit=5"`,
    },
  },
  {
    key: "test",
    label: "Test",
    icon: FlaskConical,
    tone: "green",
    title: "Run any tool before you install anything",
    text: "Each tool gets a form built from its input schema. Results come back as text, JSON, images or audio.",
    points: [
      "No install: servers start in a sandbox on demand",
      "Keys stay in this browser session unless you choose to remember them",
      "Raw output, errors and timing for every run",
    ],
    cta: {
      label: "Try the add tool",
      href: paths.server(STARTER_SERVER, { tab: "tools", tool: "add" }),
    },
    code: {
      lang: "bash",
      title: "Run a tool",
      text: [
        `curl -X POST "${API_ORIGIN}/api/v1/packages/run" \\`,
        `  -H "content-type: application/json" \\`,
        `  -d '{"packageName":"${STARTER_SERVER}","toolKey":"add","inputData":{"a":2,"b":3}}'`,
        "",
        '# "The sum of 2 and 3 is 5."',
      ].join("\n"),
    },
  },
  {
    key: "connect",
    label: "Connect",
    icon: Plug,
    tone: "purple",
    title: "Copy a working config for your client",
    text: "Every server is reachable through one gateway URL. Keys travel as headers, never in the URL.",
    points: [
      "Claude Code, Cursor, VS Code and Claude Desktop",
      "Secrets are masked unless you ask to include them",
      "Export your whole stack as one config",
    ],
    cta: {
      label: "Connect a server",
      href: paths.server(STARTER_SERVER, { tab: "setup", step: "connect" }),
    },
    code: { lang: CONNECT_SNIPPET.lang, title: "Claude Code", text: CONNECT_SNIPPET.code },
  },
  {
    key: "run",
    label: "Run",
    icon: Bot,
    tone: "orange",
    title: "Chat with agents that call tools for you",
    text: "Agents bundle servers, a system prompt and starter questions. Every tool call streams in as it happens.",
    points: [
      "Ready-made agents for weather, research, time and more",
      "Mix up to three servers in the playground",
      "Tool calls, arguments and results shown inline",
    ],
    cta: { label: "Chat with an agent", href: paths.agent(STARTER_AGENT) },
    code: {
      lang: "bash",
      title: "Agent chat (server-sent events)",
      text: [
        `curl -N -X POST "${API_ORIGIN}/api/v1/agents/chat" \\`,
        `  -H "content-type: application/json" \\`,
        `  -d '{"agentKey":"${STARTER_AGENT}","messages":[{"role":"user","content":"Add 2 and 3"}]}'`,
        "",
        '# event: tool_call    data: {"server":"...","tool":"add",...}',
        '# event: tool_result  data: {"ok":true,"ms":412,...}',
        '# event: message      data: {"content":"2 + 3 = 5"}',
      ].join("\n"),
    },
  },
];

const CATEGORY_LIMIT = 12;

export function Home() {
  const win = useWin();
  useWindowTitle("Home");
  const [panel, setPanel] = useState<PanelKey>("find");
  const [query, setQuery] = useState("");
  const progress = useProgress();

  const stats = useAsync(() => getStats(), []);
  const featured = useAsync(() => getFeatured(), []);
  const categories = useAsync(() => getCategories(), []);

  const topCategories = useMemo(
    () =>
      (categories.data ?? [])
        .filter((c) => c.key !== "uncategorized")
        .map((c) => ({ ...c, total: c.counts.mcp + c.counts.tool + c.counts.agent }))
        .sort((a, b) => b.total - a.total)
        .slice(0, CATEGORY_LIMIT),
    [categories.data],
  );

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    win.navigate(paths.explore({ q: query.trim() || undefined }));
  };

  const active = PANELS.find((p) => p.key === panel) ?? PANELS[0];
  const done = FLOW.filter((step) => progress[step.key]).length;
  const s = stats.data;

  return (
    <div className="page home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1 className="home-title">
            Base camp for <span className="marker">MCP servers</span>, tools and agents
          </h1>
          <p className="page-lead">
            Search thousands of Model Context Protocol servers, try their tools right here in the
            browser, then copy a config that works into your AI client. Nothing to install until
            you're sure.
          </p>
          <form className="home-search" onSubmit={onSearch}>
            <TextInput
              large
              icon={Search}
              type="search"
              name="q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search servers, tools and agents"
              aria-label="Search the catalog"
              end={
                <button type="submit" className="home-search-go" aria-label="Search">
                  <ArrowRight size={16} />
                </button>
              }
            />
          </form>
          <div className="page-actions">
            <ButtonLink href="/start" variant="primary" size="lg">
              Get started
            </ButtonLink>
            <ButtonLink href={paths.explore()} size="lg">
              Explore the catalog
            </ButtonLink>
          </div>
        </div>

        <aside className="home-stats" aria-label="Catalog stats">
          <div className="home-stats-head">
            <h2 className="home-stats-title">Today in the catalog</h2>
            <p className="muted">Live from the registry.</p>
          </div>
          {stats.error ? (
            <ErrorView error={stats.error} onRetry={stats.reload} title="Couldn't load stats" />
          ) : (
            <>
              <p className="home-stats-total">
                {s ? (
                  <span className="home-stats-num">{formatCount(s.servers.total)}</span>
                ) : (
                  <Skeleton width={132} height={40} />
                )}
                <span className="muted">MCP servers indexed</span>
              </p>
              <dl className="ledger">
                <LedgerRow label="Verified to start" value={s?.servers.validated} />
                <LedgerRow label="Tools" value={s?.tools.total} />
                <LedgerRow label="Agents" value={s?.agents.total} />
                <LedgerRow label="Remote servers" value={s?.servers.remote} />
                <LedgerRow label="Categories" value={s?.categories} />
              </dl>
            </>
          )}
          <ButtonLink
            href={paths.server(STARTER_SERVER, { tab: "tools", tool: "add" })}
            variant="secondary"
            iconRight={ArrowRight}
            className="home-stats-cta"
          >
            Run your first tool
          </ButtonLink>
        </aside>
      </section>

      <section className="section" aria-label="What you can do">
        <Tabs<PanelKey>
          items={PANELS.map(({ key, label, icon, tone }) => ({ key, label, icon, tone }))}
          value={panel}
          onChange={setPanel}
          label="What you can do"
          variant="panel"
        >
          <div className="home-panel">
            <div className="home-panel-copy">
              <h2 className="home-panel-title">{active.title}</h2>
              <p className="muted">{active.text}</p>
              <ul className="home-points">
                {active.points.map((point) => (
                  <li key={point}>
                    <CircleCheck size={16} aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
              <ButtonLink href={active.cta.href} variant="primary" iconRight={ArrowRight}>
                {active.cta.label}
              </ButtonLink>
            </div>
            <CodeBlock
              code={active.code.text}
              lang={active.code.lang}
              title={active.code.title}
              className="home-panel-code"
            />
          </div>
        </Tabs>
      </section>

      <Section
        title="How it works"
        sub={`${done} of ${FLOW.length} steps done`}
        link={{ label: "Open the checklist", href: "/start" }}
      >
        <ol className="flow">
          {FLOW.map((step, index) => {
            const isDone = Boolean(progress[step.key]);
            return (
              <li key={step.key} className={cx("flow-step", isDone && "is-done")}>
                <span className="flow-num" aria-hidden="true">
                  {isDone ? (
                    <Check size={15} strokeWidth={2.5} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <h3 className="flow-title">
                  <Link href={step.href} className="card-link">
                    {step.label}
                  </Link>
                  {isDone && <span className="sr-only"> (done)</span>}
                </h3>
                <p className="flow-text">{step.text}</p>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section
        title="Browse by category"
        sub={categories.data ? `${formatCount(topCategories.length)} most popular` : undefined}
        link={{ label: "All categories", href: paths.explore() }}
      >
        {categories.error ? (
          <ErrorView error={categories.error} onRetry={categories.reload} />
        ) : (
          <ul className="category-grid">
            {categories.data
              ? topCategories.map((c) => {
                  const Icon = categoryIcon(c.key);
                  return (
                    <li key={c.key} className="category-tile">
                      <span className="category-icon" aria-hidden="true">
                        <Icon size={17} strokeWidth={1.75} />
                      </span>
                      <Link href={paths.explore({ category: c.key })} className="card-link">
                        {c.name}
                      </Link>
                      <span className="category-count">{formatCount(c.total)}</span>
                    </li>
                  );
                })
              : CATEGORY_SKELETONS.map((key) => (
                  <li key={key} className="category-tile" aria-hidden="true">
                    <Skeleton width={32} height={32} />
                    <Skeleton width="60%" />
                  </li>
                ))}
          </ul>
        )}
      </Section>

      <FeaturedSection
        title="Featured MCP servers"
        sub="Verified servers people reach for first."
        href={paths.explore({ type: "mcp" })}
        state={featured}
        pick={(f) => f.servers.slice(0, 6).map(fromServer)}
      />
      <FeaturedSection
        title="Agents"
        sub="Servers, a prompt and starter questions, ready to chat."
        href={paths.explore({ type: "agent" })}
        state={featured}
        pick={(f) => f.agents.map(fromAgent)}
      />
      <FeaturedSection
        title="Curated tools"
        sub="Single tools picked from servers, one click to run."
        href={paths.explore({ type: "tool" })}
        state={featured}
        pick={(f) => f.tools.slice(0, 6).map(fromTool)}
      />

      <p className="home-foot muted">
        AlpheSDK is open source and MIT licensed.{" "}
        <Link href="/about" className="link">
          About and credits
        </Link>
      </p>
    </div>
  );
}

const CATEGORY_SKELETONS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** One line of the stats ledger: label, dotted leader, number. */
function LedgerRow({ label, value }: { label: string; value?: number }) {
  return (
    <div className="ledger-row">
      <dt>{label}</dt>
      <dd>{value === undefined ? <Skeleton width={48} /> : formatCount(value)}</dd>
    </div>
  );
}

function FeaturedSection({
  title,
  sub,
  href,
  state,
  pick,
}: {
  title: string;
  sub: string;
  href: string;
  state: AsyncState<FeaturedCatalog>;
  pick: (featured: FeaturedCatalog) => CardItem[];
}) {
  const items = state.data ? pick(state.data) : undefined;
  return (
    <Section title={title} sub={sub} link={{ label: "View all", href }}>
      {state.error ? (
        <ErrorView error={state.error} onRetry={state.reload} />
      ) : items?.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <div className="card-grid card-grid-3">
          {items ? items.map((item) => <ItemCard key={item.id} item={item} />) : <CardSkeletons />}
        </div>
      )}
    </Section>
  );
}
