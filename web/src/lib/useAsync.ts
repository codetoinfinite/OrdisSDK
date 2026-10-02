import { useCallback, useEffect, useState } from "react";
import { isAbort } from "./format";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

interface Snapshot<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

/**
 * Runs `load` whenever `deps` change (compared by JSON value) and aborts the previous run.
 * `keep` holds the previous data while the next request is in flight (no flash on refetch).
 * `skip` leaves the state idle, e.g. until the user has typed something.
 */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: { keep?: boolean; skip?: boolean } = {},
): AsyncState<T> {
  const { keep = false, skip = false } = opts;
  const [state, setState] = useState<Snapshot<T>>({ loading: !skip });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(deps);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `deps`; `load` is a new closure every render and must not retrigger.
  useEffect(() => {
    if (skip) {
      setState({ loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((prev) => ({ data: keep ? prev.data : undefined, loading: true }));
    load(ctrl.signal).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ data, loading: false });
      },
      (err: unknown) => {
        if (ctrl.signal.aborted || isAbort(err)) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({ data: keep ? prev.data : undefined, error, loading: false }));
      },
    );
    return () => ctrl.abort();
  }, [key, nonce, skip]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
