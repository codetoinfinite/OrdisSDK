import { ArrowRight, BookOpen, Check, CircleCheck, Layers, RotateCcw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { FLOW } from "../lib/flow";
import { cx, timeAgo } from "../lib/format";
import { resetProgress, toast, useProgress } from "../lib/state";
import { Badge, Button, ButtonLink, Callout } from "../ui/core";
import { paths } from "../wm/routes";

function startOver() {
  resetProgress();
  toast("Checklist reset", { body: "Steps tick off again as you do them." });
}

export function StartPage() {
  const progress = useProgress();
  const done = FLOW.filter((step) => progress[step.key]).length;
  const next = FLOW.find((step) => !progress[step.key]);

  return (
    <div className="page page-narrow start">
      <header className="page-head">
        <h1 className="page-title">Get started</h1>
        <p className="page-lead">
          Six steps from finding a server to watching an agent use it. Each one ticks itself off as
          you do it, in this browser.
        </p>
        <div className="start-progress">
          <span
            className="start-meter"
            style={{ "--done": `${(done / FLOW.length) * 100}%` } as CSSProperties}
            aria-hidden="true"
          />
          <span className="start-count">
            {done} of {FLOW.length} done
          </span>
          {done > 0 && (
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={startOver}>
              Start over
            </Button>
          )}
        </div>
      </header>

      {!next && (
        <Callout
          kind="success"
          title="You've been through the whole flow"
          action={
            <ButtonLink size="sm" icon={Layers} href="/stack">
              Open My stack
            </ButtonLink>
          }
        >
          Save the servers you like to My stack and connect them all with one config, or read the
          docs to call AlpheSDK from your own code.
        </Callout>
      )}

      <ol className="checklist">
        {FLOW.map((step, index) => {
          const at = progress[step.key];
          const isNext = step.key === next?.key;
          let badge: ReactNode = null;
          if (at) {
            badge = (
              <Badge tone="green" icon={CircleCheck}>
                Done {timeAgo(at)}
              </Badge>
            );
          } else if (isNext) {
            badge = <Badge tone="orange">Up next</Badge>;
          }
          return (
            <li
              key={step.key}
              className={cx("check-step", at !== undefined && "is-done", isNext && "is-next")}
            >
              <span className="check-mark" aria-hidden="true">
                {at ? <Check size={15} strokeWidth={2.5} /> : String(index + 1).padStart(2, "0")}
              </span>
              <div className="check-body">
                <div className="check-head">
                  <h2 className="check-title">{step.label}</h2>
                  {badge}
                </div>
                <p className="check-text">{step.text}</p>
              </div>
              <ButtonLink
                className="check-action"
                href={step.href}
                variant={isNext ? "primary" : "secondary"}
                size="sm"
                iconRight={ArrowRight}
              >
                {step.action}
              </ButtonLink>
            </li>
          );
        })}
      </ol>

      <Callout
        kind="info"
        title="Why the Everything server?"
        action={
          <ButtonLink size="sm" variant="ghost" icon={BookOpen} href={paths.docs()}>
            Read the docs
          </ButtonLink>
        }
      >
        Steps two to five open the Everything MCP Server, a test server that needs no keys of its
        own, so once your AlpheSDK API key is in, each step works straight away. Every server in the
        catalog goes through the same steps.
      </Callout>
    </div>
  );
}
