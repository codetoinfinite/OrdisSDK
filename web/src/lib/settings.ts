import { useEffect, useSyncExternalStore } from "react";
import { persistedStore, useStore } from "./store";

export type ThemePref = "system" | "light" | "dark";
export type Wallpaper = "alpine" | "glow" | "dots" | "grid" | "plain";

export interface Settings {
  theme: ThemePref;
  wallpaper: Wallpaper;
  reducedMotion: boolean;
}

// Keep the key and defaults in sync with the pre-paint script in index.html.
const DEFAULTS: Settings = { theme: "system", wallpaper: "alpine", reducedMotion: false };

// Only choices the user made are saved, so a changed default still reaches everyone who never
// picked one. (The old "alphesdk:settings" key saved the defaults too.)
export const settingsStore = persistedStore<Partial<Settings>>("local", "alphesdk:appearance", {});

export function useSettings(): Settings {
  return { ...DEFAULTS, ...useStore(settingsStore) };
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((prev) => ({ ...prev, ...patch }));
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function resolvedTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const subscribeDark = (onChange: () => void) => {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** True when the resolved theme is dark (the saved choice, or the OS theme when set to system). */
export function useIsDark(): boolean {
  const { theme } = useSettings();
  const systemDark = useSyncExternalStore(subscribeDark, () => darkQuery().matches);
  return theme === "dark" || (theme === "system" && systemDark);
}

export function toggleTheme(): void {
  updateSettings({ theme: resolvedTheme() === "dark" ? "light" : "dark" });
}

/** Applies theme, wallpaper and motion to <html>; follows the OS theme when set to system. */
export function useApplySettings(): void {
  const { theme, wallpaper, reducedMotion } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && darkQuery().matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (theme !== "system") return;
    const query = darkQuery();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.wallpaper = wallpaper;
    if (reducedMotion) root.dataset.motion = "reduce";
    else delete root.dataset.motion;
  }, [wallpaper, reducedMotion]);
}
