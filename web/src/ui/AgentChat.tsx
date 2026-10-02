import { Bot, MessageSquare, RotateCcw, Send, Square, TriangleAlert, Wrench } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { agentChat } from "../lib/api";
import { cx, duration, errorMessage, isAbort, plural } from "../lib/format";
import { markStep, useAllEnvs } from "../lib/state";
import type { AgentEvent, AgentServerRef, ChatMessage } from "../lib/types";
import { CodeBlock } from "./CodeBlock";
import { Badge, Button, Callout, Empty, IconButton, Spinner } from "./core";
import { TextArea } from "./form";
import { Markdown } from "./Markdown";

const MAX_CONTENT = 20000;
const MAX_MESSAGES = 50;
/** Status lines worth keeping after the reply (the rest only show while it runs). */
const NOTABLE = /step limit|does not offer|without tools/i;

type Part =
  | { kind: "text"; id: string; content: string }
  | {
      kind: "call";
      id: string;
      callId: string;
      server: string;
      tool: string;
      args: unknown;
      result?: { ok: boolean; ms: number; preview: string };
    };

type CallPart = Extract<Part, { kind: "call" }>;

interface UserTurn {
  id: number;
  role: "user";
  content: string;
}

interface AssistantTurn {
  id: number;
  role: "assistant";
  parts: Part[];
  running: boolean;
  status?: string;
  notes: string[];
  error?: string;
  stopped?: boolean;
  done?: { steps: number; model: string };
}

type Turn = UserTurn | AssistantTurn;

let lastId = 0;
const nextId = () => ++lastId;

function textOf(turn: AssistantTurn): string {
  return turn.parts
    .flatMap((part) => (part.kind === "text" ? [part.content] : []))
    .join("\n\n")
    .trim();
}

/** Conversation so far plus the new message, in the shape the API accepts. */
function history(turns: Turn[], next: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }
    const text = textOf(turn);
    if (text) messages.push({ role: "assistant", content: text.slice(0, MAX_CONTENT) });
  }
  messages.push({ role: "user", content: next });
  const recent = messages.slice(-MAX_MESSAGES);
  while (recent[0]?.role !== "user") recent.shift();
  return recent;
}

function apply(turn: AssistantTurn, event: AgentEvent): AssistantTurn {
  switch (event.event) {
    case "status": {
      const message = event.data.message;
      const notes =
        NOTABLE.test(message) && !turn.notes.includes(message)
          ? [...turn.notes, message]
          : turn.notes;
      return { ...turn, status: message, notes };
    }
    case "message":
      if (!event.data.content.trim()) return turn;
      return {
        ...turn,
        parts: [
          ...turn.parts,
          { kind: "text", id: `p${turn.parts.length}`, content: event.data.content },
        ],
      };
    case "tool_call":
      return {
        ...turn,
        parts: [
          ...turn.parts,
          {
            kind: "call",
            id: `p${turn.parts.length}`,
            callId: event.data.id,
            server: event.data.server,
            tool: event.data.tool,
            args: event.data.args,
          },
        ],
      };
    case "tool_result": {
      const { id, ok, ms, preview } = event.data;
      return {
        ...turn,
        parts: turn.parts.map((part) =>
          part.kind === "call" && part.callId === id && !part.result
            ? { ...part, result: { ok, ms, preview } }
            : part,
        ),
      };
    }
    case "error":
      return { ...turn, error: event.data.message };
    case "done":
      return { ...turn, done: event.data };
    default:
      return turn;
  }
}

function pretty(text: string): { code: string; lang: "json" | "text" } {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      return { code: JSON.stringify(JSON.parse(trimmed), null, 2), lang: "json" };
    } catch {
      // Not JSON (often a truncated preview); show as text.
    }
  }
  return { code: text, lang: "text" };
}

function ToolCall({ part, running }: { part: CallPart; running: boolean }) {
  const server = part.server.split("/").pop() ?? part.server;
  const input =
    typeof part.args === "string"
      ? pretty(part.args)
      : { code: JSON.stringify(part.args ?? {}, null, 2), lang: "json" as const };
  const output = part.result && pretty(part.result.preview);

  let state: ReactNode;
  if (part.result) {
    state = (
      <Badge tone={part.result.ok ? "green" : "red"}>
        {part.result.ok ? duration(part.result.ms) : "failed"}
      </Badge>
    );
  } else if (running) {
    state = <Spinner label="Running" />;
  } else {
    state = <Badge tone="muted">no result</Badge>;
  }

  return (
    <details className={cx("chat-call", part.result?.ok === false && "is-failed")}>
      <summary className="chat-call-head">
        <Wrench size={14} aria-hidden="true" />
        <code className="chat-call-tool">{part.tool}</code>
        <span className="chat-call-server">{server}</span>
        {state}
      </summary>
      <div className="chat-call-body">
        <CodeBlock code={input.code} lang={input.lang} title="Input" maxHeight={220} />
        {output && (
          <CodeBlock code={output.code} lang={output.lang} title="Result preview" maxHeight={260} />
        )}
      </div>
    </details>
  );
}

function AssistantReply({ turn }: { turn: AssistantTurn }) {
  return (
    <li className="chat-turn is-assistant">
      <span className="chat-avatar" aria-hidden="true">
        <Bot size={16} />
      </span>
      <div className="chat-bubble">
        {turn.parts.map((part) =>
          part.kind === "text" ? (
            <Markdown key={part.id} source={part.content} className="chat-text" />
          ) : (
            <ToolCall key={part.id} part={part} running={turn.running} />
          ),
        )}
        {turn.running && (
          <p className="chat-status">
            <Spinner />
            {turn.status ?? "Thinking…"}
          </p>
        )}
        {!turn.running &&
          turn.notes.map((note) => (
            <p key={note} className="chat-note">
              <TriangleAlert size={14} aria-hidden="true" />
              {note}
            </p>
          ))}
        {turn.error && (
          <Callout kind="danger" title="The agent hit an error">
            {turn.error}
          </Callout>
        )}
        {turn.stopped && <p className="chat-note">Stopped.</p>}
        {turn.done && !turn.error && (
          <p className="chat-meta">
            {plural(turn.done.steps, "step")} · {turn.done.model}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Chat with an agent: a saved agent (`agentKey`) or an ad-hoc one built from `servers`.
 * `packages` are the servers whose saved keys are sent with each message.
 */
export function AgentChat({
  agentKey,
  servers,
  packages,
  starters = [],
  intro,
}: {
  agentKey?: string;
  servers?: AgentServerRef[];
  packages: string[];
  starters?: string[];
  intro?: ReactNode;
}) {
  const inputId = useId();
  const allEnvs = useAllEnvs();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const controller = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const last = turns.at(-1);
  const running = last?.role === "assistant" && last.running;

  useEffect(() => () => controller.current?.abort(), []);

  // Follow new output while the reader is at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!turns.length || !el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const update = (id: number, change: (turn: AssistantTurn) => AssistantTurn) =>
    setTurns((prev) =>
      prev.map((turn) => (turn.id === id && turn.role === "assistant" ? change(turn) : turn)),
    );

  const send = async (text: string) => {
    const content = text.trim().slice(0, MAX_CONTENT);
    if (!content || running) return;
    const messages = history(turns, content);
    const reply: AssistantTurn = {
      id: nextId(),
      role: "assistant",
      parts: [],
      running: true,
      notes: [],
    };
    setTurns((prev) => [...prev, { id: nextId(), role: "user", content }, reply]);
    setDraft("");
    stick.current = true;

    const envs = Object.fromEntries(
      packages.flatMap((pkg) =>
        allEnvs[pkg] && Object.keys(allEnvs[pkg]).length ? [[pkg, allEnvs[pkg]]] : [],
      ),
    );
    const abort = new AbortController();
    controller.current = abort;
    let replied = false;
    let failed = false;
    try {
      await agentChat(
        {
          agentKey,
          servers: agentKey ? undefined : servers,
          messages,
          envs: Object.keys(envs).length ? envs : undefined,
        },
        (event) => {
          if (event.event === "message" && event.data.content.trim()) replied = true;
          if (event.event === "error") failed = true;
          update(reply.id, (turn) => apply(turn, event));
        },
        abort.signal,
      );
      if (replied && !failed) markStep("run");
    } catch (err) {
      if (isAbort(err)) update(reply.id, (turn) => ({ ...turn, stopped: true }));
      else update(reply.id, (turn) => ({ ...turn, error: errorMessage(err) }));
    } finally {
      if (controller.current === abort) controller.current = null;
      update(reply.id, (turn) => ({ ...turn, running: false }));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(draft);
  };

  const reset = () => {
    controller.current?.abort();
    setTurns([]);
    setDraft("");
  };

  let announce = "";
  if (last?.role === "assistant") {
    if (last.running) announce = last.status ?? "The agent is working";
    else if (last.error) announce = `Error: ${last.error}`;
    else if (last.done) announce = "Reply finished";
  }

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {turns.length ? (
          <ol className="chat-log" aria-label="Conversation">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <li key={turn.id} className="chat-turn is-user">
                  <p className="chat-bubble chat-user-text">{turn.content}</p>
                </li>
              ) : (
                <AssistantReply key={turn.id} turn={turn} />
              ),
            )}
          </ol>
        ) : (
          <div className="chat-empty">
            <Empty icon={MessageSquare} title="Start a conversation">
              {intro}
            </Empty>
            {starters.length > 0 && (
              <ul className="chat-starters" aria-label="Suggested messages">
                {starters.map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      className="chat-starter"
                      onClick={() => void send(starter)}
                    >
                      {starter}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <form className="chat-composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor={inputId}>
          Message
        </label>
        <TextArea
          id={inputId}
          rows={2}
          maxLength={MAX_CONTENT}
          placeholder="Ask something… (Shift+Enter for a new line)"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-composer-actions">
          <IconButton
            icon={RotateCcw}
            label="New conversation"
            onClick={reset}
            disabled={!turns.length}
          />
          {running ? (
            <Button icon={Square} onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" icon={Send} disabled={!draft.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
