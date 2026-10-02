import type { LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "../lib/format";
import { ExternalA } from "../wm/Link";

export type MenuEntry =
  | {
      type?: "item";
      key: string;
      label: ReactNode;
      icon?: LucideIcon;
      onSelect?: () => void;
      /** Opens in a new browser tab instead of calling onSelect. */
      href?: string;
      hint?: ReactNode;
      danger?: boolean;
    }
  | { type: "separator"; key: string }
  | { type: "heading"; key: string; label: ReactNode };

/** Dropdown menu with a button trigger; arrow keys move between items, Escape closes. */
export function Menu({
  label,
  icon: Icon,
  text,
  triggerClassName,
  align = "end",
  items,
}: {
  /** Accessible name of the trigger and the menu. */
  label: string;
  icon?: LucideIcon;
  /** Visible trigger content next to the icon. */
  text?: ReactNode;
  triggerClassName?: string;
  align?: "start" | "end";
  items: MenuEntry[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onItemKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const index = nodes.indexOf(event.currentTarget);
    const last = nodes.length - 1;
    const next =
      event.key === "ArrowDown"
        ? index >= last
          ? 0
          : index + 1
        : event.key === "ArrowUp"
          ? index <= 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    nodes[next]?.focus();
  };

  const select = (onSelect?: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    onSelect?.();
  };

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? "icon-btn icon-btn-md"}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {Icon && <Icon size={16} />}
        {text}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          className={cx("menu", `menu-${align}`)}
          role="menu"
          aria-label={label}
        >
          {items.map((entry) => {
            if (entry.type === "separator") return <hr key={entry.key} className="menu-sep" />;
            if (entry.type === "heading") {
              return (
                <div key={entry.key} className="menu-heading">
                  {entry.label}
                </div>
              );
            }
            const ItemIcon = entry.icon;
            const className = cx("menu-item", entry.danger && "is-danger");
            const content = (
              <>
                {ItemIcon && <ItemIcon size={15} />}
                <span className="menu-label">{entry.label}</span>
                {entry.hint && <span className="menu-hint">{entry.hint}</span>}
              </>
            );
            return entry.href ? (
              <ExternalA
                key={entry.key}
                href={entry.href}
                className={className}
                role="menuitem"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                onKeyDown={onItemKey}
              >
                {content}
              </ExternalA>
            ) : (
              <button
                key={entry.key}
                type="button"
                className={className}
                role="menuitem"
                tabIndex={-1}
                onClick={() => select(entry.onSelect)}
                onKeyDown={onItemKey}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
