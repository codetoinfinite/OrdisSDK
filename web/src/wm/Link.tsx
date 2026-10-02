import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useWinOptional, useWm } from "./WindowManager";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  /** Replace the window's current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Always open in a new window (also on Cmd/Ctrl/Shift-click). */
  newWindow?: boolean;
}

/** In-app link: navigates the surrounding window (a page that belongs in another window opens
    there), or opens a window from the desktop and menu bar. */
export function Link({ href, replace, newWindow, onClick, children, ...rest }: LinkProps) {
  const wm = useWm();
  const win = useWinOptional();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
    event.preventDefault();
    if (newWindow || event.metaKey || event.ctrlKey || event.shiftKey)
      wm.open(href, { newWindow: true });
    else if (win) win.navigate(href, { replace });
    else wm.open(href);
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

/** External link; always a new browser tab without an opener. */
export function ExternalA({ children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
