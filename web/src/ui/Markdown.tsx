import { lexer, type MarkedToken, type Token } from "marked";
import { Fragment, type ReactNode, useMemo } from "react";
import { cx } from "../lib/format";
import type { Lang } from "../lib/highlight";
import { ExternalA, Link } from "../wm/Link";
import { CodeBlock } from "./CodeBlock";

/*
 * Markdown from docs, descriptions and model output is untrusted. It is lexed with marked and
 * rendered as React elements: no HTML string is ever injected, raw HTML shows as text, images are
 * never loaded, and only in-app, http(s) and mailto links become links.
 */

const LANGS: Record<string, Lang> = {
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ts: "ts",
  typescript: "ts",
  tsx: "ts",
  js: "ts",
  javascript: "ts",
  jsx: "ts",
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  larr: "←",
  rarr: "→",
  times: "×",
};

/** The lexer decodes numeric character references but leaves named ones such as `&amp;`. */
function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&([a-z]+);/gi,
    (match, name: string) => ENTITIES[name.toLowerCase()] ?? match,
  );
}

/** Parsed markdown never reorders, so positional keys are stable. */
function each<T>(items: readonly T[], render: (item: T, key: string) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) out.push(render(items[i], `k${i}`));
  return out;
}

function linkKind(href: string): "internal" | "external" | null {
  if (href.startsWith("/") && !href.startsWith("//")) return "internal";
  try {
    const { protocol } = new URL(href);
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:"
      ? "external"
      : null;
  } catch {
    return null;
  }
}

function inline(tokens: Token[] | undefined): ReactNode[] {
  return each(tokens ?? [], (token, key) => {
    const t = token as MarkedToken;
    switch (t.type) {
      case "text":
        return (
          <Fragment key={key}>{t.tokens?.length ? inline(t.tokens) : decode(t.text)}</Fragment>
        );
      case "escape":
        return <Fragment key={key}>{t.text}</Fragment>;
      case "codespan":
        return <code key={key}>{t.text}</code>;
      case "strong":
        return <strong key={key}>{inline(t.tokens)}</strong>;
      case "em":
        return <em key={key}>{inline(t.tokens)}</em>;
      case "del":
        return <del key={key}>{inline(t.tokens)}</del>;
      case "br":
        return <br key={key} />;
      case "link": {
        const kind = linkKind(t.href);
        const children = inline(t.tokens);
        if (kind === "internal") {
          return (
            <Link key={key} href={t.href} className="link">
              {children}
            </Link>
          );
        }
        if (kind === "external") {
          return (
            <ExternalA key={key} href={t.href} className="link" title={t.title ?? undefined}>
              {children}
            </ExternalA>
          );
        }
        return <span key={key}>{children}</span>;
      }
      case "image": {
        const label = `Image: ${t.text || "untitled"}`;
        return linkKind(t.href) ? (
          <ExternalA key={key} href={t.href} className="link md-image">
            {label}
          </ExternalA>
        ) : (
          <span key={key} className="md-image">
            {label}
          </span>
        );
      }
      case "html":
        return /^<br\s*\/?>$/i.test(t.text) ? (
          <br key={key} />
        ) : (
          <Fragment key={key}>{t.text}</Fragment>
        );
      case "checkbox":
        return (
          <input
            key={key}
            type="checkbox"
            defaultChecked={t.checked}
            disabled
            aria-label={t.checked ? "Done" : "To do"}
          />
        );
      default:
        return null;
    }
  });
}

function blocks(tokens: Token[]): ReactNode[] {
  return each(tokens, (token, key) => {
    const t = token as MarkedToken;
    switch (t.type) {
      case "paragraph":
        return <p key={key}>{inline(t.tokens)}</p>;
      case "text":
        // Tight list items hold bare text blocks instead of paragraphs.
        return (
          <Fragment key={key}>{t.tokens?.length ? inline(t.tokens) : decode(t.text)}</Fragment>
        );
      case "heading": {
        const Tag = `h${Math.min(6, t.depth + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={key}>{inline(t.tokens)}</Tag>;
      }
      case "code": {
        const raw = (t.lang ?? "").split(/\s/)[0].toLowerCase();
        const lang = LANGS[raw];
        return (
          <CodeBlock
            key={key}
            code={t.text}
            lang={lang}
            title={lang ? undefined : raw || undefined}
          />
        );
      }
      case "blockquote":
        return <blockquote key={key}>{blocks(t.tokens)}</blockquote>;
      case "list": {
        const items = each(t.items, (item, itemKey) => (
          <li key={itemKey} className={item.task ? "md-task" : undefined}>
            {blocks(item.tokens)}
          </li>
        ));
        if (!t.ordered) return <ul key={key}>{items}</ul>;
        return (
          <ol key={key} start={typeof t.start === "number" && t.start !== 1 ? t.start : undefined}>
            {items}
          </ol>
        );
      }
      case "table":
        return (
          <div key={key} className="md-table">
            <table>
              <thead>
                <tr>
                  {each(t.header, (cell, cellKey) => (
                    <th key={cellKey} style={cell.align ? { textAlign: cell.align } : undefined}>
                      {inline(cell.tokens)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {each(t.rows, (row, rowKey) => (
                  <tr key={rowKey}>
                    {each(row, (cell, cellKey) => (
                      <td key={cellKey} style={cell.align ? { textAlign: cell.align } : undefined}>
                        {inline(cell.tokens)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "hr":
        return <hr key={key} />;
      case "html":
        return (
          <p key={key} className="md-html">
            {t.text}
          </p>
        );
      case "checkbox":
        return (
          <input
            key={key}
            type="checkbox"
            defaultChecked={t.checked}
            disabled
            aria-label={t.checked ? "Done" : "To do"}
          />
        );
      default:
        return null;
    }
  });
}

/** Renders untrusted markdown safely. `#` headings start at h2 because windows own the h1. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const tokens = useMemo(() => {
    try {
      return lexer(source, { gfm: true });
    } catch {
      return null;
    }
  }, [source]);

  return <div className={cx("prose", className)}>{tokens ? blocks(tokens) : <p>{source}</p>}</div>;
}
