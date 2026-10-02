import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Ban,
  BookmarkCheck,
  BookmarkPlus,
  Bot,
  CircleAlert,
  Cloud,
  KeyRound,
  Server,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx, plural } from "../lib/format";
import type { CardItem } from "../lib/items";
import { inStack, toast, toggleStack, useStack } from "../lib/state";
import type { ItemType } from "../lib/types";
import { Link } from "../wm/Link";
import { Badge, Monogram, Skeleton, type ToneName } from "./core";
import { Highlight } from "./Highlight";

export const TYPE_META: Record<ItemType, { label: string; tone: ToneName; icon: LucideIcon }> = {
  mcp: { label: "MCP server", tone: "green", icon: Server },
  tool: { label: "Tool", tone: "teal", icon: Wrench },
  agent: { label: "Agent", tone: "purple", icon: Bot },
};

/** Status badges for a catalog entry (also used on detail pages). */
export function itemBadges(item: CardItem): ReactNode[] {
  const out: ReactNode[] = [];
  if (item.blocked) {
    out.push(
      <Badge key="blocked" tone="red" icon={Ban} title="Blocked in this registry">
        Blocked
      </Badge>,
    );
  } else if (item.validated) {
    out.push(
      <Badge key="verified" tone="green" icon={BadgeCheck} title="Started and listed its tools">
        Verified
      </Badge>,
    );
  }
  if (item.runnable === false && !item.blocked) {
    out.push(
      <Badge key="unavailable" tone="red" icon={CircleAlert} title="A server it needs is missing">
        Unavailable
      </Badge>,
    );
  }
  if (item.needsKeys) {
    out.push(
      <Badge key="keys" tone="yellow" icon={KeyRound}>
        Needs keys
      </Badge>,
    );
  }
  if (item.remote) {
    out.push(
      <Badge key="remote" tone="blue" icon={Cloud}>
        Remote
      </Badge>,
    );
  }
  if (item.runtime) out.push(<Badge key="runtime">{item.runtime}</Badge>);
  if (item.toolCount) out.push(<Badge key="tools">{plural(item.toolCount, "tool")}</Badge>);
  if (item.serverCount) out.push(<Badge key="servers">{plural(item.serverCount, "server")}</Badge>);
  return out;
}

/** Catalog card: the whole card opens the item; the bookmark saves it to My stack. */
export function ItemCard({ item }: { item: CardItem }) {
  const stack = useStack();
  const meta = TYPE_META[item.type];
  const stackId = item.stackId;
  const saved = stackId !== undefined && inStack(stack, item.type, stackId);

  const save = () => {
    if (stackId === undefined) return;
    const added = toggleStack({ type: item.type, id: stackId, name: item.name });
    toast(added ? "Added to My stack" : "Removed from My stack", {
      kind: added ? "success" : "info",
      body: item.name,
    });
  };

  return (
    <article className={cx("card", item.blocked && "is-blocked")}>
      <div className="card-head">
        <Monogram name={item.name} size={40} icon={item.type === "mcp" ? undefined : meta.icon} />
        <div className="card-titles">
          <h3 className="card-title">
            <Link href={item.href} className="card-link">
              <Highlight text={item.highlight?.name} fallback={item.name} />
            </Link>
          </h3>
          <p className="card-meta">
            <span className={cx("card-type", `tone-${meta.tone}`)}>{meta.label}</span>
            <span className="truncate">
              {item.type === "tool" && item.serverName ? item.serverName : item.categoryName}
            </span>
          </p>
        </div>
        {stackId !== undefined && (
          <button
            type="button"
            className="card-save"
            aria-pressed={saved}
            aria-label={`Save ${item.name} to My stack`}
            title={saved ? "In My stack" : "Add to My stack"}
            onClick={save}
          >
            {saved ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
          </button>
        )}
      </div>
      <p className="card-desc">
        <Highlight
          text={item.highlight?.description}
          fallback={item.description || "No description yet."}
        />
      </p>
      <div className="badge-row card-badges">{itemBadges(item)}</div>
    </article>
  );
}

const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

export function CardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <>
      {SKELETON_KEYS.slice(0, count).map((key) => (
        <div key={key} className="card is-skeleton" aria-hidden="true">
          <div className="card-head">
            <Skeleton width={40} height={40} />
            <div className="card-titles">
              <Skeleton width="70%" height={16} />
              <Skeleton width="45%" height={12} />
            </div>
          </div>
          <Skeleton width="100%" />
          <Skeleton width="80%" />
        </div>
      ))}
    </>
  );
}
