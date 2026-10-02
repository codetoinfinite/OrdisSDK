import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { dismissToast, type ToastKind, useToasts } from "../lib/state";
import { IconButton } from "../ui/core";

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } satisfies Record<
  ToastKind,
  LucideIcon
>;

export function Toaster() {
  const toasts = useToasts();
  return (
    <section className="toaster" aria-live="polite" aria-label="Notifications">
      {toasts.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            <Icon size={18} className="toast-icon" />
            <div className="toast-body">
              <p className="toast-title">{item.title}</p>
              {item.body && <p className="toast-text">{item.body}</p>}
            </div>
            <IconButton icon={X} label="Dismiss" size="sm" onClick={() => dismissToast(item.id)} />
          </div>
        );
      })}
    </section>
  );
}
