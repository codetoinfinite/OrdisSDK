import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Copy,
  Info,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Tone } from "../lib/categories";
import { compact, cx, errorMessage, initials } from "../lib/format";
import { toast } from "../lib/state";
import { Link, type LinkProps } from "../wm/Link";

export type ToneName = Tone | "muted";

/* ---------- Buttons ---------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cx("btn", `btn-${variant}`, `btn-${size}`, extra);
}

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonLook {
  loading?: boolean;
}

export function Button({
  variant,
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const px = ICON_SIZE[size];
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle size={px} className="spin" /> : Icon && <Icon size={px} />}
      {children}
      {IconRight && <IconRight size={px} />}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps, ButtonLook {}

/** An in-app link that looks like a button. */
export function ButtonLink({
  variant,
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const px = ICON_SIZE[size];
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon size={px} />}
      {children}
      {IconRight && <IconRight size={px} />}
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  size?: "sm" | "md";
  active?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  size = "md",
  active,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx("icon-btn", `icon-btn-${size}`, active && "is-active", className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={size === "sm" ? 14 : 16} />
    </button>
  );
}

/* ---------- Small pieces ---------- */

export function Badge({
  tone,
  icon: Icon,
  title,
  className,
  children,
}: {
  tone?: ToneName;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("badge", tone && `tone-${tone}`, className)} title={title}>
      {Icon ? (
        <Icon size={12} />
      ) : (
        tone && tone !== "muted" && <span className="badge-dot" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading", showLabel }: { label?: string; showLabel?: boolean }) {
  return (
    <span className="spinner">
      <LoaderCircle size={16} className="spin" />
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Empty({
  icon: Icon = CircleDashed,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("empty", className)}>
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export type CalloutKind = "info" | "success" | "warn" | "danger";

const CALLOUT_ICON: Record<CalloutKind, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
};

export function Callout({
  kind = "info",
  title,
  children,
  action,
  className,
}: {
  kind?: CalloutKind;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = CALLOUT_ICON[kind];
  return (
    <div
      className={cx("callout", `callout-${kind}`, className)}
      role={kind === "danger" ? "alert" : undefined}
    >
      <Icon size={18} className="callout-icon" />
      <div className="callout-body">
        {title && <p className="callout-title">{title}</p>}
        {children && <div className="callout-text">{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}

/** Initials (or an icon) on a keycap, standing in for a logo; external logos are never loaded. */
export function Monogram({
  name,
  size = 36,
  icon: Icon,
}: {
  name: string;
  size?: number;
  icon?: LucideIcon;
}) {
  return (
    <span
      className="monogram"
      style={{ "--size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {Icon ? <Icon size={Math.round(size * 0.46)} strokeWidth={1.75} /> : initials(name)}
    </span>
  );
}

export function Skeleton({
  width,
  height = 14,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <span className={cx("skeleton", className)} style={{ width, height }} aria-hidden="true" />
  );
}

/* ---------- Tabs ---------- */

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: LucideIcon;
  tone?: ToneName;
  count?: number;
}

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange(key: K): void;
  /** Accessible name of the tab list. */
  label: string;
  variant?: "underline" | "panel";
  className?: string;
  /** Content of the selected tab. */
  children: ReactNode;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  variant = "underline",
  className,
  children,
}: TabsProps<K>) {
  const id = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());
  const selected = items.find((item) => item.key === value) ?? items[0];

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const key = items[next].key;
    onChange(key);
    refs.current.get(key)?.focus();
  };

  return (
    <div className={cx("tabs", `tabs-${variant}`, className)}>
      <div className="tablist" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = item.key === selected?.key;
          return (
            <button
              key={item.key}
              ref={(el) => {
                if (el) refs.current.set(item.key, el);
                return () => {
                  refs.current.delete(item.key);
                };
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${item.key}`}
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              className={cx("tab", item.tone && `tone-${item.tone}`)}
              onClick={() => onChange(item.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {Icon && <Icon size={15} />}
              {item.label}
              {item.count !== undefined && <span className="tab-count">{compact(item.count)}</span>}
            </button>
          );
        })}
      </div>
      <div
        className={cx("tabpanel", selected?.tone && `tone-${selected.tone}`)}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={selected ? `${id}-tab-${selected.key}` : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- Copy ---------- */

export function CopyButton({
  text,
  label = "Copy",
  onCopied,
  showLabel,
  className,
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
  showLabel?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
    } catch {
      toast("Couldn't copy", {
        kind: "error",
        body: "Your browser blocked clipboard access. Select the text and copy it manually.",
      });
    }
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className={cx("copy-btn", copied && "is-copied", className)}
      onClick={copy}
      aria-label={showLabel ? undefined : label}
      title={label}
    >
      <Icon size={14} />
      {showLabel && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

/* ---------- Errors ---------- */

/** Renders `backtick` spans in an error message as inline code. */
function InlineCode({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<code key={start}>{match[1]}</code>);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ErrorView({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Callout
      kind="danger"
      title={title}
      action={
        onRetry && (
          <Button size="sm" icon={RotateCcw} onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {error !== undefined && <InlineCode text={errorMessage(error)} />}
    </Callout>
  );
}

/* ---------- Sections ---------- */

/** Page section: title, optional subtitle and a "more" link on the right. */
export function Section({
  title,
  sub,
  link,
  children,
}: {
  title: string;
  sub?: string;
  link?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {sub && <p className="section-sub">{sub}</p>}
        </div>
        {link && (
          <Link href={link.href} className="section-link">
            {link.label}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
