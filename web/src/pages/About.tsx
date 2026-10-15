import { BookOpen, Braces } from "lucide-react";
import { getStats } from "../lib/api";
import { API_ORIGIN } from "../lib/config";
import { formatCount } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Logo } from "../shell/Logo";
import { Badge, ButtonLink, buttonClass, ErrorView, Section, Skeleton } from "../ui/core";
import { ExternalA } from "../wm/Link";
import { paths } from "../wm/routes";

/** What AlpheSDK is built with. Licences as each package declares them. */
const CREDITS = [
  { name: "React", role: "Interface", license: "MIT", href: "https://react.dev" },
  { name: "Vite", role: "Dev server and build", license: "MIT", href: "https://vite.dev" },
  { name: "Hono", role: "API server", license: "MIT", href: "https://hono.dev" },
  {
    name: "MCP TypeScript SDK",
    role: "Talking to MCP servers",
    license: "MIT",
    href: "https://modelcontextprotocol.io",
  },
  {
    name: "Meilisearch JS",
    role: "Search client",
    license: "MIT",
    href: "https://github.com/meilisearch/meilisearch-js",
  },
  { name: "Zod", role: "Request validation", license: "MIT", href: "https://zod.dev" },
  { name: "marked", role: "Markdown", license: "MIT", href: "https://marked.js.org" },
  { name: "Lucide", role: "Icons", license: "ISC", href: "https://lucide.dev" },
  {
    name: "IBM Plex Sans",
    role: "Interface font",
    license: "OFL-1.1",
    href: "https://fontsource.org/fonts/ibm-plex-sans",
  },
  {
    name: "IBM Plex Mono",
    role: "Code font",
    license: "OFL-1.1",
    href: "https://fontsource.org/fonts/ibm-plex-mono",
  },
];

export function AboutPage() {
  const stats = useAsync(() => getStats(), []);
  const s = stats.data;

  return (
    <div className="page page-narrow about-page">
      <header className="about-hero">
        <Logo size={72} />
        <h1 className="about-title">
          Alphe<span className="brand-sdk">SDK</span>
        </h1>
        <p className="page-lead">
          The toolbox for your AI agents: a self-hosted catalog, gateway and workbench for Model
          Context Protocol servers and agents.
        </p>
        {stats.error ? (
          <ErrorView error={stats.error} onRetry={stats.reload} title="Couldn't load version" />
        ) : (
          <dl className="about-facts">
            <Fact label="Version" value={s?.version} />
            <Fact label="Catalog" value={s && `${formatCount(s.servers.total)} servers`} />
            <Fact
              label="Search"
              value={s && (s.search.engine === "meilisearch" ? "Meilisearch" : "Built-in")}
            />
          </dl>
        )}
        <div className="page-actions about-links">
          <ButtonLink href={paths.docs()} icon={BookOpen}>
            Docs
          </ButtonLink>
          <ExternalA href={`${API_ORIGIN}/swagger`} className={buttonClass()}>
            <Braces size={16} aria-hidden="true" />
            API reference
          </ExternalA>
        </div>
      </header>

      <Section title="Open-source software">
        <ul className="panel">
          {CREDITS.map((credit) => (
            <li key={credit.name} className="about-credit">
              <ExternalA href={credit.href} className="about-credit-name">
                {credit.name}
              </ExternalA>
              <span className="about-credit-role">{credit.role}</span>
              <Badge className="about-credit-license">{credit.license}</Badge>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Good to know">
        <ul className="about-notes">
          <li>
            Each MCP server is its own project, with its own licence and terms. Check a server's
            repository before you rely on it.
          </li>
          <li>
            The desktop look takes cues from PostHog's website but is drawn from scratch, with no
            PostHog artwork, fonts or code. AlpheSDK isn't affiliated with PostHog.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="about-fact">
      <dt className="about-fact-label">{label}</dt>
      <dd className="about-fact-value">{value ?? <Skeleton width={48} />}</dd>
    </div>
  );
}
