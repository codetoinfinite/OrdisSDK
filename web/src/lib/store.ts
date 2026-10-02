import { useSyncExternalStore } from "react";

/** Minimal external store for state shared across windows. */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

type Area = "local" | "session";

function area(kind: Area): Storage | undefined {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Storage can be unavailable (private mode, blocked site data); every call degrades to a no-op. */
export function readJson<T>(kind: Area, key: string, fallback: T): T {
  try {
    const raw = area(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(kind: Area, key: string, value: unknown): void {
  try {
    area(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: state stays in memory for this tab.
  }
}

export function removeKey(kind: Area, key: string): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    // Ignore blocked storage.
  }
}

/** A store that mirrors itself into web storage. */
export function persistedStore<T>(kind: Area, key: string, fallback: T): Store<T> {
  const store = createStore<T>(readJson(kind, key, fallback));
  store.subscribe(() => writeJson(kind, key, store.get()));
  return store;
}
