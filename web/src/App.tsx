import { useApplySettings } from "./lib/settings";
import { CommandPalette } from "./shell/CommandPalette";
import { Desktop } from "./shell/Desktop";
import { MenuBar } from "./shell/MenuBar";
import { Toaster } from "./shell/Toaster";
import { WindowManagerProvider } from "./wm/WindowManager";

export function App() {
  useApplySettings();
  return (
    <WindowManagerProvider>
      <MenuBar />
      <Desktop />
      <CommandPalette />
      <Toaster />
    </WindowManagerProvider>
  );
}
