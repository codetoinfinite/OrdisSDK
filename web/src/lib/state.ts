import { createStore, persistedStore, readJson, removeKey, useStore, writeJson } from "./store";
import type { EnvVar, ItemType } from "./types";

/* ---------- My stack: servers, curated tools and agents the user saved ---------- */

export interface StackItem {
  type: ItemType;
  /** packageName for servers, key for tools and agents. */
  id: string;
  name: string;
  addedAt: number;
}

export const stackStore = persistedStore<StackItem[]>("local", "alphesdk:stack", []);

export const useStack = () => useStore(stackStore);

export function inStack(items: StackItem[], type: ItemType, id: string): boolean {
  return items.some((item) => item.type === type && item.id === id);
}

export function toggleStack(item: Omit<StackItem, "addedAt">): boolean {
  const items = stackStore.get();
  if (inStack(items, item.type, item.id)) {
    stackStore.set(items.filter((i) => !(i.type === item.type && i.id === item.id)));
    return false;
  }
  stackStore.set([...items, { ...item, addedAt: Date.now() }]);
  return true;
}

export function clearStack(): void {
  stackStore.set([]);
}

/* ---------- Keys: per-package env values ----------
   Session values live in sessionStorage; "Remember on this device" also copies them to
   localStorage. Values are only ever sent to the local API in POST bodies or x-mcp-env-* headers. */

type EnvMap = Record<string, Record<string, string>>;

const SESSION_KEY = "alphesdk:envs";
const REMEMBERED_KEY = "alphesdk:envs:remembered";

function loadEnvs(): { session: EnvMap; remembered: EnvMap } {
  return {
    session: readJson<EnvMap>("session", SESSION_KEY, {}),
    remembered: readJson<EnvMap>("local", REMEMBERED_KEY, {}),
  };
}

export const envStore = createStore(loadEnvs());

export function useEnvValues(packageName: string): Record<string, string> {
  const { session, remembered } = useStore(envStore);
  return { ...remembered[packageName], ...session[packageName] };
}

export function useAllEnvs(): EnvMap {
  const { session, remembered } = useStore(envStore);
  const merged: EnvMap = { ...remembered };
  for (const [pkg, values] of Object.entries(session)) merged[pkg] = { ...merged[pkg], ...values };
  return merged;
}

export function envValues(packageName: string): Record<string, string> {
  const { session, remembered } = envStore.get();
  return { ...remembered[packageName], ...session[packageName] };
}

export function isRemembered(packageName: string): boolean {
  return Boolean(envStore.get().remembered[packageName]);
}

export function setEnv(
  packageName: string,
  values: Record<string, string>,
  remember: boolean,
): void {
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
  const { session, remembered } = envStore.get();
  const nextSession = { ...session, [packageName]: clean };
  const nextRemembered = { ...remembered };
  if (remember && Object.keys(clean).length) nextRemembered[packageName] = clean;
  else delete nextRemembered[packageName];
  writeJson("session", SESSION_KEY, nextSession);
  writeJson("local", REMEMBERED_KEY, nextRemembered);
  envStore.set({ session: nextSession, remembered: nextRemembered });
}

export function clearAllEnvs(): void {
  removeKey("session", SESSION_KEY);
  removeKey("local", REMEMBERED_KEY);
  envStore.set({ session: {}, remembered: {} });
}

/** Required keys without a default that have no value yet. */
export function missingKeys(env: Record<string, EnvVar>, values: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([name, spec]) => spec.required && !spec.default && !values[name]?.trim())
    .map(([name]) => name);
}

/* ---------- Get started progress ---------- */

export const STEPS = ["discover", "inspect", "configure", "test", "connect", "run"] as const;
export type StepKey = (typeof STEPS)[number];

export const progressStore = persistedStore<Partial<Record<StepKey, number>>>(
  "local",
  "alphesdk:progress",
  {},
);

export const useProgress = () => useStore(progressStore);

export function markStep(step: StepKey): void {
  if (progressStore.get()[step]) return;
  progressStore.set((prev) => ({ ...prev, [step]: Date.now() }));
}

export function resetProgress(): void {
  progressStore.set({});
}

/* ---------- Command palette ---------- */

export const paletteStore = createStore(false);
export const usePaletteOpen = () => useStore(paletteStore);
export const openPalette = () => paletteStore.set(true);
export const closePalette = () => paletteStore.set(false);

/* ---------- Toasts ---------- */

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

export const toastStore = createStore<Toast[]>([]);
export const useToasts = () => useStore(toastStore);

let toastSeq = 0;

export function toast(title: string, opts: { kind?: ToastKind; body?: string } = {}): void {
  const id = ++toastSeq;
  toastStore.set((prev) => [
    ...prev.slice(-3),
    { id, kind: opts.kind ?? "info", title, body: opts.body },
  ]);
  window.setTimeout(() => dismissToast(id), opts.kind === "error" ? 7000 : 4000);
}

export function dismissToast(id: number): void {
  toastStore.set((prev) => prev.filter((t) => t.id !== id));
}
