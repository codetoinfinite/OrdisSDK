import { MOD_LABEL } from "../lib/config";
import { Kbd } from "../ui/core";
import { ExternalA, Link } from "../wm/Link";
import { Window } from "../wm/Window";
import { useWmState } from "../wm/WindowManager";
import { LAUNCHERS_LEFT, LAUNCHERS_RIGHT, type Launcher } from "./launchers";
import { Scenery } from "./Scenery";

function DeskIcon({ app }: { app: Launcher }) {
  const Icon = app.icon;
  const content = (
    <>
      <span className="desk-glyph">
        <Icon size={30} strokeWidth={1.5} />
      </span>
      <span className="desk-label">{app.label}</span>
    </>
  );
  return app.external ? (
    <ExternalA href={app.href} className="desk-icon">
      {content}
    </ExternalA>
  ) : (
    <Link href={app.href} className="desk-icon">
      {content}
    </Link>
  );
}

export function Desktop() {
  const { wins, focusId } = useWmState();
  const empty = wins.every((win) => win.minimized);

  return (
    <div className="desk">
      <div className="wallpaper">
        <Scenery />
      </div>
      <nav className="desk-icons" aria-label="Desktop">
        <div className="desk-col">
          {LAUNCHERS_LEFT.map((app) => (
            <DeskIcon key={app.id} app={app} />
          ))}
        </div>
        <div className="desk-col">
          {LAUNCHERS_RIGHT.map((app) => (
            <DeskIcon key={app.id} app={app} />
          ))}
        </div>
      </nav>
      {empty && (
        <p className="desk-hint">
          Open an app from the icons, or press <Kbd>{MOD_LABEL}</Kbd>
          <Kbd>K</Kbd> to search.
        </p>
      )}
      <div className="desk-windows">
        {wins.map((win) => (
          <Window key={win.id} win={win} focused={win.id === focusId} />
        ))}
      </div>
    </div>
  );
}
