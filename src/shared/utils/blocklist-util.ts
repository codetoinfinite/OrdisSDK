import path from "node:path";
import { getDirname } from "./file-util";

const __dirname = getDirname(import.meta.url);
const BLACKLIST_PATH = path.join(__dirname, "../../../config/hosting-blacklist.mjs");

let blacklist: Promise<Set<string>> | null = null;

/** Keys and package names from config/hosting-blacklist.mjs, loaded once. */
export function loadHostingBlacklist(): Promise<Set<string>> {
  blacklist ??= import(`file://${BLACKLIST_PATH}`).then(
    (m) => new Set<string>(m.default),
    (e) => {
      blacklist = null;
      throw e;
    },
  );
  return blacklist;
}

type BlockTarget = { key?: string; packageName: string };

/**
 * Blocked when the registry key (`indexKey`, the packages-list.json key), `config.key` or
 * `config.packageName` is on the hosting blacklist.
 */
export function isBlockedBy(set: Set<string>, config: BlockTarget, indexKey?: string) {
  return [indexKey, config.key, config.packageName].some((k) => !!k && set.has(k));
}

export async function isBlocked(config: BlockTarget, indexKey?: string) {
  return isBlockedBy(await loadHostingBlacklist(), config, indexKey);
}

export const BLOCK_REASON =
  "On the hosting blacklist: the registry entry points at a different project's package, so AlpheSDK never runs it.";

/** Thrown when something tries to list, run or proxy a blacklisted package. */
export class BlockedPackageError extends Error {
  constructor(key: string) {
    super(`Package '${key}' is blocked (hosting blacklist)`);
    this.name = "BlockedPackageError";
  }
}
