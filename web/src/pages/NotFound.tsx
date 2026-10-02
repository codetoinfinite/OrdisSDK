import { CircleAlert, House } from "lucide-react";
import { ButtonLink, Empty } from "../ui/core";
import { paths } from "../wm/routes";
import { useWin, useWindowTitle } from "../wm/WindowManager";

export function NotFound() {
  const { route } = useWin();
  useWindowTitle("Not found");
  return (
    <div className="page page-narrow">
      <Empty
        icon={CircleAlert}
        title="Off the trail"
        action={
          <ButtonLink href={paths.home()} variant="primary" icon={House}>
            Go home
          </ButtonLink>
        }
      >
        No page at <code>{route.pathname}</code>. The link may be old, or the item was removed from
        the catalog.
      </Empty>
    </div>
  );
}
