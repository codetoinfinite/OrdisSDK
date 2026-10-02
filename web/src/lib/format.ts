import type { EnvVar } from "./types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 1234 -> "1.2k", 12345 -> "12k". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function firstLine(text: string | undefined): string {
  return (text ?? "").trim().split("\n")[0] ?? "";
}

/** The URL when it is http(s), else undefined; catalog links are untrusted. */
export function httpUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

/** "@scope/server-name" -> "server-name"; used for client config names. */
export function slugify(name: string): string {
  const base = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "server";
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Slugs that stay unique within one exported config. */
export function uniqueSlugs(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const slug = slugify(name);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return n === 1 ? slug : `${slug}-${n}`;
  });
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|(^|_)PAT($|_)/i;

export function isSecretKey(name: string, env?: EnvVar): boolean {
  return env?.secret ?? SECRET_NAME.test(name);
}

/** Two-letter monogram for a name or package, e.g. "@acme/fast-search" -> "FS". */
export function initials(name: string): string {
  const base = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  const words = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^(mcp|server)$/i.test(w));
  const picked = words.length ? words : base.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!picked.length) return "?";
  if (picked.length === 1) return picked[0].slice(0, 2).toUpperCase();
  return (picked[0][0] + picked[1][0]).toUpperCase();
}

/** 850 -> "850 ms", 12300 -> "12.3 s". */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Something went wrong.";
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
