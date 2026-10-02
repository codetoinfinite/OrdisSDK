import type { ReactNode } from "react";

const MARK = /<mark>(.*?)<\/mark>/gs;

/**
 * Renders a search hit's `_formatted` text. Meilisearch does not HTML-escape it, so it is never
 * injected as HTML: only the <mark> pairs become elements, everything else stays plain text.
 */
export function Highlight({ text, fallback }: { text?: string; fallback: ReactNode }) {
  if (!text) return <>{fallback}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<mark key={start}>{match[1]}</mark>);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
