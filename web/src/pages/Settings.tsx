import { Flag, KeyRound, Layers, type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cx, plural } from "../lib/format";
import { updateSettings, useIsDark, useSettings, type Wallpaper } from "../lib/settings";
import {
  clearAllEnvs,
  clearStack,
  envStore,
  resetProgress,
  STEPS,
  toast,
  useProgress,
  useStack,
} from "../lib/state";
import { useStore } from "../lib/store";
import { Button, Monogram, Section } from "../ui/core";
import { Checkbox, Segmented } from "../ui/form";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";

const WALLPAPERS: { key: Wallpaper; label: string }[] = [
  { key: "alpine", label: "Alpine" },
  { key: "glow", label: "Glow" },
  { key: "dots", label: "Dots" },
  { key: "grid", label: "Grid" },
  { key: "plain", label: "Plain" },
];

const hasValues = (values: Record<string, string>) => Object.values(values).some(Boolean);

export function SettingsPage() {
  const settings = useSettings();
  const isDark = useIsDark();
  const { session, remembered } = useStore(envStore);
  const stack = useStack();
  const progress = useProgress();

  const keyed = new Set(
    [...Object.entries(session), ...Object.entries(remembered)]
      .filter(([, values]) => hasValues(values))
      .map(([pkg]) => pkg),
  );
  const rememberedCount = Object.values(remembered).filter(hasValues).length;
  const doneSteps = STEPS.filter((step) => progress[step]).length;

  let keysDetail = "No keys saved.";
  if (keyed.size) {
    keysDetail = `Keys for ${plural(keyed.size, "server")}`;
    keysDetail += rememberedCount
      ? `, ${rememberedCount} remembered on this device.`
      : ", in this tab only.";
  }

  return (
    <div className="page page-narrow settings-page">
      <header className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-lead">
          These are kept in this browser only and never sent to the server.
        </p>
      </header>

      <Section title="Appearance">
        <div className="panel">
          <div className="settings-row">
            <span className="settings-label" aria-hidden="true">
              Theme
            </span>
            <div className="settings-control">
              <Segmented
                label="Theme"
                value={settings.theme}
                onChange={(theme) => updateSettings({ theme })}
                options={[
                  { key: "system", label: "System", icon: Monitor },
                  { key: "light", label: "Light", icon: Sun },
                  { key: "dark", label: "Dark", icon: Moon },
                ]}
              />
              {settings.theme === "system" && (
                <p className="settings-hint">
                  Follows your device, which is {isDark ? "dark" : "light"} right now.
                </p>
              )}
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label" aria-hidden="true">
              Wallpaper
            </span>
            <fieldset className="wallpaper-picker">
              <legend className="sr-only">Wallpaper</legend>
              {WALLPAPERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="wallpaper-option"
                  aria-pressed={settings.wallpaper === item.key}
                  onClick={() => updateSettings({ wallpaper: item.key })}
                >
                  <span className={cx("wallpaper-swatch", `is-${item.key}`)} aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </fieldset>
          </div>

          <div className="settings-row">
            <span className="settings-label" aria-hidden="true">
              Motion
            </span>
            <Checkbox
              label="Reduce motion"
              hint="Windows, cards and scrolling stop animating. This is always on when your device asks for less motion."
              checked={settings.reducedMotion}
              onChange={(event) => updateSettings({ reducedMotion: event.target.checked })}
            />
          </div>
        </div>
      </Section>

      <Section title="Saved in this browser">
        <ul className="panel">
          <DataRow
            icon={KeyRound}
            title="Keys"
            detail={keysDetail}
            action="Clear keys"
            question={`Clear the keys for ${plural(keyed.size, "server")}? You'll need to enter them again.`}
            done="Keys cleared"
            empty={!keyed.size}
            onConfirm={clearAllEnvs}
          />
          <DataRow
            icon={Layers}
            title="My stack"
            detail={stack.length ? `${plural(stack.length, "item")} saved.` : "Nothing saved."}
            action="Clear stack"
            question={`Remove all ${plural(stack.length, "item")} from My stack?`}
            done="My stack is empty"
            empty={!stack.length}
            onConfirm={clearStack}
          />
          <DataRow
            icon={Flag}
            title="Get started checklist"
            detail={`${doneSteps} of ${STEPS.length} steps done.`}
            action="Reset"
            question="Mark every step as not done?"
            done="Checklist reset"
            empty={!doneSteps}
            onConfirm={resetProgress}
          />
        </ul>
        <p className="settings-note">
          How keys are stored and sent is explained in{" "}
          <Link href={paths.docs("keys")} className="link">
            Keys and privacy
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

/** Clearing asks first, in place. Focus lands on Cancel so a stray Enter keeps the data. */
function DataRow({
  icon: Icon,
  title,
  detail,
  action,
  question,
  done,
  empty,
  onConfirm,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  action: string;
  question: string;
  done: string;
  empty: boolean;
  onConfirm(): void;
}) {
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const questionId = useId();

  const ask = (next: boolean) => {
    flushSync(() => setAsking(next));
    box.current?.querySelector<HTMLButtonElement>("button:last-child")?.focus();
  };

  const confirm = () => {
    onConfirm();
    setAsking(false);
    toast(done, { kind: "success" });
  };

  return (
    <li className="settings-data">
      <Monogram name={title} size={34} icon={Icon} />
      <div className="settings-data-text">
        <p className="settings-data-title">{title}</p>
        <p id={questionId} className={cx("settings-data-detail", asking && "is-asking")}>
          {asking ? question : detail}
        </p>
      </div>
      <div className="settings-data-actions" ref={box}>
        {asking ? (
          <>
            <Button variant="danger" size="sm" aria-describedby={questionId} onClick={confirm}>
              {action}
            </Button>
            <Button size="sm" aria-describedby={questionId} onClick={() => ask(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={empty} onClick={() => ask(true)}>
            {action}
          </Button>
        )}
      </div>
    </li>
  );
}
