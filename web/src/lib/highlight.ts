/** Tiny regex tokenizers for the snippets we generate (JSON, shell, TypeScript). */

export type Lang = "json" | "bash" | "ts" | "text";
export type TokenKind = "key" | "string" | "number" | "keyword" | "flag" | "comment" | "variable";

export interface Token {
  text: string;
  kind?: TokenKind;
  /** Offset in the source; unique, so it doubles as a React key. */
  start: number;
}

const PATTERNS: Partial<Record<Lang, RegExp>> = {
  json: /(?<key>"(?:[^"\\\n]|\\.)*"(?=\s*:))|(?<string>"(?:[^"\\\n]|\\.)*")|(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<keyword>\b(?:true|false|null)\b)/g,
  bash: /(?<comment>(?<=^|\s)#[^\n]*)|(?<string>'[^'\n]*'|"(?:[^"\\\n]|\\.)*")|(?<variable>\$\{?[A-Za-z_]\w*\}?)|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<keyword>(?<=^|\n|\s)(?:curl|claude|npx|export|pnpm|node|docker|git|cd)\b)/g,
  ts: /(?<comment>\/\/[^\n]*)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<keyword>\b(?:import|from|const|let|await|async|new|return|export|function|type|interface|if|else|for|of)\b)|(?<number>\b\d+(?:\.\d+)?\b)/g,
};

export function tokenize(code: string, lang: Lang): Token[] {
  const pattern = PATTERNS[lang];
  if (!pattern) return [{ text: code, start: 0 }];
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push({ text: code.slice(last, start), start: last });
    const groups = match.groups ?? {};
    const kind = (Object.keys(groups) as TokenKind[]).find((name) => groups[name] !== undefined);
    tokens.push({ text: match[0], kind, start });
    last = start + match[0].length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last), start: last });
  return tokens;
}
