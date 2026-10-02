import { useEffect, useRef } from "react";

/**
 * Keeps a <dialog> in step with `open` (showModal/close). Escape, a click on the backdrop and
 * dialog.close() all end up in onClose, so the caller's state stays the single source of truth.
 */
export function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const latest = useRef(onClose);

  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCloseEvent = () => latest.current();
    const onClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) dialog.close();
    };
    dialog.addEventListener("close", onCloseEvent);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("close", onCloseEvent);
      dialog.removeEventListener("click", onClick);
    };
  }, []);

  return ref;
}
