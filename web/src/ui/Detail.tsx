import type { LucideIcon } from "lucide-react";
import { ArrowLeft, BookmarkCheck, BookmarkPlus, ScanSearch } from "lucide-react";
import { type ReactNode, useId } from "react";
import { ApiError } from "../lib/api";
import { inStack, toast, toggleStack, useStack } from "../lib/state";
import type { ItemType } from "../lib/types";
import { Button, ButtonLink, Empty, ErrorView, Monogram, Skeleton } from "./core";

/* Building blocks shared by the server, tool and agent pages. */

export function DetailHead({
  name,
  sub,
  icon,
  actions,
}: {
  name: string;
  sub?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="detail-head">
      <Monogram name={name} size={56} icon={icon} />
      <div className="detail-titles">
        <h1 className="detail-title">{name}</h1>
        {sub && <div className="detail-sub">{sub}</div>}
      </div>
      {actions && <div className="detail-actions">{actions}</div>}
    </header>
  );
}

export function StackButton({ type, id, name }: { type: ItemType; id: string; name: string }) {
  const stack = useStack();
  const saved = inStack(stack, type, id);

  const toggle = () => {
    const added = toggleStack({ type, id, name });
    toast(added ? "Added to My stack" : "Removed from My stack", {
      kind: added ? "success" : "info",
      body: name,
    });
  };

  return (
    <Button
      icon={saved ? BookmarkCheck : BookmarkPlus}
      title={saved ? "Remove from My stack" : undefined}
      onClick={toggle}
    >
      {saved ? "In My stack" : "Add to My stack"}
    </Button>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Key facts in a small card, e.g. package, runtime, licence. */
export function Facts({
  title = "Details",
  items,
  children,
}: {
  title?: string;
  items: Fact[];
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="facts-card" aria-labelledby={id}>
      <h2 className="facts-title" id={id}>
        {title}
      </h2>
      <dl className="facts">
        {items.map((item) => (
          <div key={item.label} className="fact">
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

export function DetailSkeleton() {
  return (
    <div className="page detail">
      <span className="sr-only">Loading…</span>
      <div className="detail-head" aria-hidden="true">
        <Skeleton width={56} height={56} />
        <div className="detail-titles">
          <Skeleton width="min(320px, 70%)" height={26} />
          <Skeleton width="min(220px, 50%)" />
        </div>
      </div>
      <div className="detail-intro" aria-hidden="true">
        <Skeleton width="min(560px, 90%)" />
        <Skeleton width="min(420px, 70%)" />
      </div>
    </div>
  );
}

/** Not found (404) or a load error, in place of a detail page. */
export function DetailError({
  error,
  onRetry,
  what,
  name,
  back,
}: {
  error: unknown;
  onRetry(): void;
  /** "Server", "Tool" or "Agent". */
  what: string;
  name: string;
  back: { href: string; label: string };
}) {
  const notFound = error instanceof ApiError && error.code === 404;
  return (
    <div className="page page-narrow">
      {notFound ? (
        <Empty
          icon={ScanSearch}
          title={`${what} not found`}
          action={
            <ButtonLink href={back.href} icon={ArrowLeft}>
              {back.label}
            </ButtonLink>
          }
        >
          Nothing in the catalog is called <code>{name}</code>.
        </Empty>
      ) : (
        <ErrorView
          title={`Couldn't load this ${what.toLowerCase()}`}
          error={error}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}
