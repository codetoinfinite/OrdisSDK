import { type CSSProperties, Fragment, useMemo } from "react";
import { cx } from "../lib/format";
import { type Lang, tokenize } from "../lib/highlight";
import { CopyButton } from "./core";

const LANG_LABEL: Record<Lang, string> = {
  json: "JSON",
  bash: "Shell",
  ts: "TypeScript",
  text: "Text",
};

export function CodeBlock({
  code,
  lang = "text",
  title,
  onCopy,
  className,
  maxHeight,
}: {
  code: string;
  lang?: Lang;
  title?: string;
  onCopy?: () => void;
  className?: string;
  /** CSS length or pixels; the body scrolls beyond it. */
  maxHeight?: number | string;
}) {
  const tokens = useMemo(() => tokenize(code, lang), [code, lang]);
  const style =
    maxHeight === undefined
      ? undefined
      : ({
          "--max-h": typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        } as CSSProperties);

  return (
    <figure className={cx("code", className)}>
      <figcaption className="code-head">
        <span className="code-title">{title ?? LANG_LABEL[lang]}</span>
        <CopyButton text={code} onCopied={onCopy} showLabel />
      </figcaption>
      <pre className="code-body" style={style}>
        <code>
          {tokens.map((token) =>
            token.kind ? (
              <span key={token.start} className={`tok-${token.kind}`}>
                {token.text}
              </span>
            ) : (
              <Fragment key={token.start}>{token.text}</Fragment>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
