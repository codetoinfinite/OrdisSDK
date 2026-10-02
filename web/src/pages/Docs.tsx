import { ArrowLeft, ArrowRight, BookOpen, ChevronRight } from "lucide-react";
import { lexer, type MarkedToken } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOCS, type Doc, findDoc } from "../docs";
import { API_ORIGIN } from "../lib/config";
import { cx } from "../lib/format";
import { ButtonLink, Callout, Empty, Monogram } from "../ui/core";
import { Markdown } from "../ui/Markdown";
import { ExternalA, Link } from "../wm/Link";
import { paths } from "../wm/routes";
import { useWin, useWindowTitle } from "../wm/WindowManager";

export function DocsPage() {
  const { route } = useWin();
  const slug = route.params.slug;
  const doc = findDoc(slug);
  useWindowTitle(doc?.title ?? "Docs");

  if (!slug) return <DocsIndex />;
  if (!doc) {
    return (
      <div className="page page-narrow">
        <Empty
          icon={BookOpen}
          title="No such page"
          action={
            <ButtonLink href={paths.docs()} variant="secondary" icon={ArrowLeft}>
              All docs
            </ButtonLink>
          }
        >
          There's no doc at this address. It may have moved.
        </Empty>
      </div>
    );
  }
  // Keyed so the section tracking starts fresh on every page.
  return <DocView key={doc.slug} doc={doc} />;
}

function DocsIndex() {
  return (
    <div className="page docs-index">
      <header className="page-head">
        <h1 className="page-title">Docs</h1>
        <p className="page-lead">
          Run AlpheSDK, connect your MCP clients, call the API and add your own tools and agents.
        </p>
      </header>
      <ul className="docs-grid">
        {DOCS.map((doc) => {
          const Icon = doc.icon;
          return (
            <li key={doc.slug} className="card docs-card">
              <Monogram name={doc.title} size={34} icon={Icon} />
              <h2 className="docs-card-title">
                <Link href={paths.docs(doc.slug)} className="card-link">
                  {doc.title}
                </Link>
              </h2>
              <p className="docs-card-text">{doc.summary}</p>
              <ArrowRight size={16} className="docs-card-arrow" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
      <Callout title="API reference">
        Every endpoint with its parameters and responses is in{" "}
        <ExternalA href={`${API_ORIGIN}/swagger`} className="link">
          Swagger UI
        </ExternalA>
        , generated from the server's OpenAPI document.
      </Callout>
    </div>
  );
}

const reduceMotion = () =>
  document.documentElement.dataset.motion === "reduce" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function DocView({ doc }: { doc: Doc }) {
  const source = useMemo(() => doc.source.replaceAll("{{origin}}", API_ORIGIN), [doc]);
  const sections = useMemo(
    () =>
      lexer(source).flatMap((token) => {
        const t = token as MarkedToken;
        return t.type === "heading" && t.depth === 1 ? [t.text] : [];
      }),
    [source],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const index = DOCS.indexOf(doc);
  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];

  // Highlight the section at the top of the window; the last one once the page bottoms out.
  useEffect(() => {
    const body = bodyRef.current;
    const scroller = body?.closest(".window-body");
    if (!body || !scroller) return;
    const update = () => {
      const headings = Array.from(body.querySelectorAll("h2"));
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const line = scroller.getBoundingClientRect().top + 80;
      const passed = headings.filter((h) => h.getBoundingClientRect().top <= line).length;
      setActive(atEnd && scroller.scrollTop > 0 ? headings.length - 1 : Math.max(0, passed - 1));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, []);

  const jump = (i: number) => {
    const heading = bodyRef.current?.querySelectorAll("h2")[i];
    if (!heading) return;
    heading.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    // Move focus too, so keyboard and screen reader users continue from the section.
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  };

  return (
    <div className="page docs-page">
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="All docs">
          <p className="docs-side-title">Docs</p>
          <ul>
            {DOCS.map((item) => {
              const Icon = item.icon;
              const current = item === doc;
              return (
                <li key={item.slug}>
                  <Link
                    href={paths.docs(item.slug)}
                    className={cx("docs-nav-link", current && "is-active")}
                    aria-current={current ? "page" : undefined}
                  >
                    <Icon size={15} className="docs-nav-icon" aria-hidden="true" />
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <article className="docs-article">
          <header className="docs-head">
            <nav className="docs-crumbs" aria-label="Breadcrumb">
              <Link href={paths.docs()} className="docs-crumb-link">
                Docs
              </Link>
              <ChevronRight size={14} aria-hidden="true" />
              <span aria-current="page">{doc.title}</span>
            </nav>
            <h1 className="page-title">{doc.title}</h1>
          </header>
          <div ref={bodyRef}>
            <Markdown source={source} className="docs-prose" />
          </div>
          <nav className="docs-pager" aria-label="Previous and next">
            {prev && (
              <Link href={paths.docs(prev.slug)} className="docs-pager-link is-prev">
                <span className="docs-pager-label">
                  <ArrowLeft size={14} aria-hidden="true" />
                  Previous
                </span>
                <span className="docs-pager-title">{prev.title}</span>
              </Link>
            )}
            {next && (
              <Link href={paths.docs(next.slug)} className="docs-pager-link is-next">
                <span className="docs-pager-label">
                  Next
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
                <span className="docs-pager-title">{next.title}</span>
              </Link>
            )}
          </nav>
        </article>

        {sections.length > 1 && (
          <nav className="docs-toc" aria-label="On this page">
            <p className="docs-side-title">On this page</p>
            <ul>
              {sections.map((title, i) => (
                <li key={title}>
                  <button
                    type="button"
                    className={cx("docs-toc-link", i === active && "is-active")}
                    aria-current={i === active ? "location" : undefined}
                    onClick={() => jump(i)}
                  >
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
