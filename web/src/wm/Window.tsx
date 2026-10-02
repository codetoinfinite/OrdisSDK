import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Minus, X } from "lucide-react";
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { cx } from "../lib/format";
import { ErrorView, IconButton } from "../ui/core";
import { APPS } from "./apps";
import { APP_META } from "./routes";
import { useWm, type Win, WinContext, type WinContextValue } from "./WindowManager";

const MIN_W = 360;
const MIN_H = 260;
/** Below this width every window is full-size and cannot be dragged. */
const MOBILE = 768;
/** How much of a window must stay reachable when dragged off an edge. */
const GRIP = 120;

const INTERACTIVE = "button, a, input, select, textarea";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export const Window = memo(function Window({ win, focused }: { win: Win; focused: boolean }) {
  const wm = useWm();
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { id } = win;
  const meta = APP_META[win.route.app];
  const Page = APPS[win.route.app];
  const Icon = meta.icon;

  const navigate = useCallback(
    (href: string, opts?: { replace?: boolean }) => wm.navigate(id, href, opts),
    [wm, id],
  );
  const setTitle = useCallback((title: string) => wm.setTitle(id, title), [wm, id]);
  const ctx = useMemo<WinContextValue>(
    () => ({ id, route: win.route, focused, navigate, setTitle }),
    [id, win.route, focused, navigate, setTitle],
  );

  // Any press or focus inside the window raises it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raise = () => wm.focus(id);
    el.addEventListener("pointerdown", raise, true);
    el.addEventListener("focusin", raise);
    return () => {
      el.removeEventListener("pointerdown", raise, true);
      el.removeEventListener("focusin", raise);
    };
  }, [wm, id]);

  // Drag by the title bar; double-click toggles maximize. Position is committed on release.
  useEffect(() => {
    const el = ref.current;
    const bar = el?.querySelector<HTMLElement>(".window-bar");
    if (!el || !bar) return;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || el.classList.contains("is-max") || window.innerWidth < MOBILE)
        return;
      if ((event.target as Element).closest(INTERACTIVE)) return;
      const parent = el.parentElement;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = el.offsetLeft;
      const originY = el.offsetTop;
      let x = originX;
      let y = originY;
      bar.setPointerCapture(event.pointerId);
      el.dataset.dragging = "";

      const onMove = (e: PointerEvent) => {
        const maxX = (parent?.clientWidth ?? window.innerWidth) - GRIP;
        const maxY = (parent?.clientHeight ?? window.innerHeight) - 40;
        x = clamp(originX + e.clientX - startX, GRIP - el.offsetWidth, maxX);
        y = clamp(originY + e.clientY - startY, 0, maxY);
        el.style.setProperty("--x", `${x}px`);
        el.style.setProperty("--y", `${y}px`);
      };
      const onUp = () => {
        bar.removeEventListener("pointermove", onMove);
        bar.removeEventListener("pointerup", onUp);
        bar.removeEventListener("pointercancel", onUp);
        delete el.dataset.dragging;
        if (x !== originX || y !== originY) wm.move(id, x, y);
      };
      bar.addEventListener("pointermove", onMove);
      bar.addEventListener("pointerup", onUp);
      bar.addEventListener("pointercancel", onUp);
    };
    const onDouble = (event: MouseEvent) => {
      if (window.innerWidth < MOBILE || (event.target as Element).closest(INTERACTIVE)) return;
      wm.toggleMax(id);
    };

    bar.addEventListener("pointerdown", onDown);
    bar.addEventListener("dblclick", onDouble);
    return () => {
      bar.removeEventListener("pointerdown", onDown);
      bar.removeEventListener("dblclick", onDouble);
    };
  }, [wm, id]);

  // Resize from the right edge, bottom edge or corner.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onDown = (event: PointerEvent) => {
      const handle = (event.target as Element).closest<HTMLElement>(".window-rs");
      if (!handle || event.button !== 0) return;
      event.preventDefault();
      const dir = handle.dataset.rs ?? "se";
      const parent = el.parentElement;
      const maxW = (parent?.clientWidth ?? window.innerWidth) - Math.max(0, el.offsetLeft) - 8;
      const maxH = (parent?.clientHeight ?? window.innerHeight) - el.offsetTop - 8;
      const startX = event.clientX;
      const startY = event.clientY;
      const originW = el.offsetWidth;
      const originH = el.offsetHeight;
      let w = originW;
      let h = originH;
      handle.setPointerCapture(event.pointerId);
      el.dataset.dragging = "";

      const onMove = (e: PointerEvent) => {
        if (dir !== "s") {
          w = clamp(originW + e.clientX - startX, MIN_W, maxW);
          el.style.setProperty("--w", `${w}px`);
        }
        if (dir !== "e") {
          h = clamp(originH + e.clientY - startY, MIN_H, maxH);
          el.style.setProperty("--h", `${h}px`);
        }
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        delete el.dataset.dragging;
        if (w !== originW || h !== originH) wm.resize(id, w, h);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };

    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [wm, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page starts at the top
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [win.route.pathname]);

  const style = {
    "--x": `${win.x}px`,
    "--y": `${win.y}px`,
    "--w": `${win.w}px`,
    "--h": `${win.h}px`,
    zIndex: win.z,
  } as CSSProperties;

  return (
    <WinContext.Provider value={ctx}>
      <section
        ref={ref}
        className={cx(
          "window",
          focused && "is-focused",
          win.maximized && "is-max",
          win.minimized && "is-min",
        )}
        aria-label={win.title}
        style={style}
      >
        <div className="window-bar">
          <div className="window-nav">
            <IconButton
              icon={ChevronLeft}
              label="Back"
              size="sm"
              disabled={win.index === 0}
              onClick={() => wm.back(id)}
            />
            <IconButton
              icon={ChevronRight}
              label="Forward"
              size="sm"
              disabled={win.index >= win.history.length - 1}
              onClick={() => wm.forward(id)}
            />
          </div>
          <div className={cx("window-title", `tone-${meta.tone}`)}>
            <Icon size={15} />
            <span className="truncate">{win.title}</span>
          </div>
          <div className="window-controls">
            <IconButton icon={Minus} label="Minimize" size="sm" onClick={() => wm.minimize(id)} />
            <IconButton
              icon={win.maximized ? Minimize2 : Maximize2}
              label={win.maximized ? "Restore" : "Maximize"}
              size="sm"
              onClick={() => wm.toggleMax(id)}
            />
            <IconButton
              icon={X}
              label="Close"
              size="sm"
              className="window-close"
              onClick={() => wm.close(id)}
            />
          </div>
        </div>
        <div ref={bodyRef} className="window-body">
          <PageBoundary key={win.route.key}>
            <Page />
          </PageBoundary>
        </div>
        <div className="window-rs" data-rs="e" aria-hidden="true" />
        <div className="window-rs" data-rs="s" aria-hidden="true" />
        <div className="window-rs" data-rs="se" aria-hidden="true" />
      </section>
    </WinContext.Provider>
  );
});

interface BoundaryState {
  failed: boolean;
  error?: unknown;
}

/** Keeps a crashing page inside its own window instead of blanking the desktop. */
class PageBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[AlpheSDK] window crashed", error, info.componentStack);
  }

  reset = () => this.setState({ failed: false, error: undefined });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-crash">
        <ErrorView error={this.state.error} title="This window crashed" onRetry={this.reset} />
      </div>
    );
  }
}
