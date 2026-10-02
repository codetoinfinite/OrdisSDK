import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer } from "react";
import { APP_META, MAIN_WINDOW, parseRoute, type Route } from "./routes";

/* Desktop window manager. Every page runs inside a window with its own back/forward history;
   the focused window's URL is mirrored into the address bar, so links and reloads work.
   Pages share one main window that changes content; apps with their own window (APP_META
   `window`) open beside it and are focused, not duplicated, when opened again. */

export interface Win {
  id: number;
  /** "main", the id of an app with its own window, or a unique key for an extra window. */
  key: string;
  route: Route;
  history: string[];
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  title: string;
}

export interface WmState {
  wins: Win[];
  focusId: number | null;
  zTop: number;
  seq: number;
  /** How the next address-bar sync writes history. */
  urlMode: "push" | "replace";
}

interface Viewport {
  vw: number;
  vh: number;
}

type Action =
  | ({ type: "OPEN"; href: string; newWindow?: boolean } & Viewport)
  | ({ type: "POP"; href: string } & Viewport)
  | ({ type: "NAVIGATE"; id: number; href: string; replace?: boolean } & Viewport)
  | { type: "BACK" | "FORWARD" | "FOCUS" | "CLOSE" | "MINIMIZE" | "TOGGLE_MAX"; id: number }
  | { type: "MOVE"; id: number; x: number; y: number }
  | { type: "RESIZE"; id: number; w: number; h: number }
  | { type: "SET_TITLE"; id: number; title: string }
  | { type: "CLOSE_ALL" };

/** Height of the menu bar area above the window layer (matches --desk-top in tokens.css). */
const DESK_TOP = 62;

function viewport(): Viewport {
  return { vw: window.innerWidth, vh: window.innerHeight - DESK_TOP };
}

function place(route: Route, count: number, { vw, vh }: Viewport) {
  const [dw, dh] = APP_META[route.app].window ?? MAIN_WINDOW;
  const side = vw >= 1100 ? 112 : 16;
  const w = Math.max(320, Math.min(dw, vw - side * 2));
  const h = Math.max(240, Math.min(dh, vh - 16));
  const offset = (count % 6) * 28;
  const x = Math.min(
    Math.max(side, Math.round((vw - w) / 2) + offset),
    Math.max(side, vw - w - side),
  );
  const y = Math.min(offset, Math.max(0, vh - h - 16));
  return { x, y, w, h };
}

function topVisible(wins: Win[]): number | null {
  let best: Win | undefined;
  for (const win of wins) if (!win.minimized && (!best || win.z > best.z)) best = win;
  return best?.id ?? null;
}

function update(state: WmState, id: number, patch: (win: Win) => Partial<Win>): WmState {
  return {
    ...state,
    wins: state.wins.map((win) => (win.id === id ? { ...win, ...patch(win) } : win)),
  };
}

function focus(state: WmState, id: number): WmState {
  const win = state.wins.find((w) => w.id === id);
  if (!win) return state;
  if (state.focusId === id && win.z === state.zTop && !win.minimized) return state;
  const z = state.zTop + 1;
  return { ...update(state, id, () => ({ z, minimized: false })), focusId: id, zTop: z };
}

/** The same page (same route key) keeps the title it set; a different page starts from its app name. */
function titleFor(win: Win, route: Route): string {
  return route.key === win.route.key ? win.title : APP_META[route.app].title;
}

function go(win: Win, href: string, replace = false): Partial<Win> {
  const route = parseRoute(href);
  const history = replace
    ? win.history.map((h, i) => (i === win.index ? route.href : h))
    : [...win.history.slice(0, win.index + 1), route.href];
  return {
    route,
    history,
    index: replace ? win.index : win.index + 1,
    title: titleFor(win, route),
  };
}

function step(win: Win, delta: number): Partial<Win> {
  const index = win.index + delta;
  const route = parseRoute(win.history[index]);
  return { route, index, title: titleFor(win, route) };
}

/** The window a route belongs in: the main window, or the app's own. */
function slot(route: Route): string {
  return APP_META[route.app].window ? route.app : "main";
}

function open(state: WmState, href: string, vp: Viewport, newWindow = false): WmState {
  const route = parseRoute(href);
  const key = slot(route);
  if (!newWindow) {
    let existing: Win | undefined;
    for (const win of state.wins)
      if (win.key === key && (!existing || win.z > existing.z)) existing = win;
    if (existing) {
      const target = existing;
      const moved =
        target.route.href === route.href
          ? state
          : update(state, target.id, (w) => go(w, route.href));
      return { ...focus(moved, target.id), urlMode: "push" };
    }
  }
  const seq = state.seq + 1;
  const z = state.zTop + 1;
  const win: Win = {
    id: seq,
    key: newWindow ? `${key}#${seq}` : key,
    route,
    history: [route.href],
    index: 0,
    ...place(route, state.wins.length, vp),
    z,
    minimized: false,
    maximized: vp.vw < 768,
    title: APP_META[route.app].title,
  };
  return { ...state, wins: [...state.wins, win], focusId: seq, zTop: z, seq, urlMode: "push" };
}

function reducer(state: WmState, action: Action): WmState {
  switch (action.type) {
    case "OPEN":
      return open(state, action.href, action, action.newWindow);
    case "POP": {
      const route = parseRoute(action.href);
      const focused = state.wins.find((w) => w.id === state.focusId);
      if (focused) {
        if (focused.route.href === route.href) return state;
        for (const delta of [-1, 1]) {
          if (focused.history[focused.index + delta] === route.href) {
            return { ...update(state, focused.id, (w) => step(w, delta)), urlMode: "replace" };
          }
        }
      }
      const match = state.wins.find((w) => w.route.href === route.href);
      if (match) return { ...focus(state, match.id), urlMode: "replace" };
      return { ...open(state, route.href, action), urlMode: "replace" };
    }
    case "NAVIGATE": {
      const route = parseRoute(action.href);
      const win = state.wins.find((w) => w.id === action.id);
      if (!win) return state;
      // A page that belongs in another window opens there instead of replacing this one.
      if (slot(route) !== slot(win.route)) return open(state, route.href, action);
      const next =
        win.route.href === route.href
          ? state
          : update(state, win.id, (w) => go(w, route.href, action.replace));
      return { ...focus(next, win.id), urlMode: action.replace ? "replace" : "push" };
    }
    case "BACK":
    case "FORWARD": {
      const delta = action.type === "BACK" ? -1 : 1;
      const win = state.wins.find((w) => w.id === action.id);
      if (!win || !win.history[win.index + delta]) return state;
      return {
        ...focus(
          update(state, action.id, (w) => step(w, delta)),
          action.id,
        ),
        urlMode: "replace",
      };
    }
    case "FOCUS": {
      const next = focus(state, action.id);
      return next === state ? state : { ...next, urlMode: "replace" };
    }
    case "CLOSE": {
      const wins = state.wins.filter((w) => w.id !== action.id);
      const focusId = state.focusId === action.id ? topVisible(wins) : state.focusId;
      return { ...state, wins, focusId, urlMode: "replace" };
    }
    case "MINIMIZE": {
      const next = update(state, action.id, () => ({ minimized: true }));
      const focusId = state.focusId === action.id ? topVisible(next.wins) : state.focusId;
      return { ...next, focusId, urlMode: "replace" };
    }
    case "TOGGLE_MAX":
      return focus(
        update(state, action.id, (w) => ({ maximized: !w.maximized })),
        action.id,
      );
    case "MOVE":
      return update(state, action.id, () => ({ x: action.x, y: action.y }));
    case "RESIZE":
      return update(state, action.id, () => ({ w: action.w, h: action.h }));
    case "SET_TITLE": {
      const win = state.wins.find((w) => w.id === action.id);
      if (!win || win.title === action.title) return state;
      return update(state, action.id, () => ({ title: action.title }));
    }
    case "CLOSE_ALL":
      return { ...state, wins: [], focusId: null, urlMode: "replace" };
  }
}

function init(): WmState {
  const empty: WmState = { wins: [], focusId: null, zTop: 0, seq: 0, urlMode: "replace" };
  const { pathname, search, hash } = window.location;
  return { ...open(empty, pathname + search + hash, viewport()), urlMode: "replace" };
}

export interface WmActions {
  open(href: string, opts?: { newWindow?: boolean }): void;
  navigate(id: number, href: string, opts?: { replace?: boolean }): void;
  back(id: number): void;
  forward(id: number): void;
  focus(id: number): void;
  close(id: number): void;
  minimize(id: number): void;
  toggleMax(id: number): void;
  move(id: number, x: number, y: number): void;
  resize(id: number, w: number, h: number): void;
  setTitle(id: number, title: string): void;
  closeAll(): void;
}

const ActionsContext = createContext<WmActions | null>(null);
const StateContext = createContext<WmState | null>(null);

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  const actions = useMemo<WmActions>(
    () => ({
      open: (href, opts) =>
        dispatch({ type: "OPEN", href, newWindow: opts?.newWindow, ...viewport() }),
      navigate: (id, href, opts) =>
        dispatch({ type: "NAVIGATE", id, href, replace: opts?.replace, ...viewport() }),
      back: (id) => dispatch({ type: "BACK", id }),
      forward: (id) => dispatch({ type: "FORWARD", id }),
      focus: (id) => dispatch({ type: "FOCUS", id }),
      close: (id) => dispatch({ type: "CLOSE", id }),
      minimize: (id) => dispatch({ type: "MINIMIZE", id }),
      toggleMax: (id) => dispatch({ type: "TOGGLE_MAX", id }),
      move: (id, x, y) => dispatch({ type: "MOVE", id, x, y }),
      resize: (id, w, h) => dispatch({ type: "RESIZE", id, w, h }),
      setTitle: (id, title) => dispatch({ type: "SET_TITLE", id, title }),
      closeAll: () => dispatch({ type: "CLOSE_ALL" }),
    }),
    [],
  );

  const focused = state.wins.find((w) => w.id === state.focusId);
  const href = focused?.route.href ?? "/";
  const title = focused ? `${focused.title} · AlpheSDK` : "AlpheSDK";

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname + search + hash === href) return;
    if (state.urlMode === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  }, [href, state.urlMode]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const onPop = () => {
      const { pathname, search, hash } = window.location;
      dispatch({ type: "POP", href: pathname + search + hash, ...viewport() });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useWm(): WmActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useWm must be used inside WindowManagerProvider");
  return ctx;
}

export function useWmState(): WmState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useWmState must be used inside WindowManagerProvider");
  return ctx;
}

/* ---------- Per-window context ---------- */

export interface WinContextValue {
  id: number;
  route: Route;
  focused: boolean;
  navigate(href: string, opts?: { replace?: boolean }): void;
  setTitle(title: string): void;
}

export const WinContext = createContext<WinContextValue | null>(null);

export function useWin(): WinContextValue {
  const ctx = useContext(WinContext);
  if (!ctx) throw new Error("useWin must be used inside a window");
  return ctx;
}

export const useWinOptional = () => useContext(WinContext);

/** Sets the window title (and the document title while focused). */
export function useWindowTitle(title: string | undefined): void {
  const win = useWinOptional();
  const setTitle = win?.setTitle;
  useEffect(() => {
    if (setTitle && title) setTitle(title);
  }, [setTitle, title]);
}

/** Query string of the window's current route. */
export function useRouteQuery(): URLSearchParams {
  const { route } = useWin();
  return useMemo(() => new URLSearchParams(route.search), [route.search]);
}
