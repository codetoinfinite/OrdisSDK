import { AppWindow, X } from "lucide-react";
import { Menu, type MenuEntry } from "../ui/Menu";
import { APP_META } from "../wm/routes";
import { useWm, useWmState } from "../wm/WindowManager";

/** Menu-bar list of open windows, including minimized ones. */
export function WindowSwitcher() {
  const { wins, focusId } = useWmState();
  const wm = useWm();
  if (!wins.length) return null;

  const items: MenuEntry[] = [
    { type: "heading", key: "heading", label: "Open windows" },
    ...[...wins]
      .sort((a, b) => b.z - a.z)
      .map(
        (win): MenuEntry => ({
          key: String(win.id),
          label: win.title,
          icon: APP_META[win.route.app].icon,
          hint: win.minimized ? "Minimized" : win.id === focusId ? "Active" : undefined,
          onSelect: () => wm.focus(win.id),
        }),
      ),
    { type: "separator", key: "sep" },
    { key: "close-all", label: "Close all windows", icon: X, danger: true, onSelect: wm.closeAll },
  ];

  return (
    <Menu
      label={`Windows (${wins.length} open)`}
      icon={AppWindow}
      text={<span>{wins.length}</span>}
      triggerClassName="switcher-btn"
      items={items}
    />
  );
}
