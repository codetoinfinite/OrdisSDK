import { CircleAlert, CircleCheck, FileCode, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { cx, duration } from "../lib/format";
import type { ToolContent, ToolRunResult } from "../lib/types";
import { ExternalA } from "../wm/Link";
import { CodeBlock } from "./CodeBlock";
import { Badge } from "./core";
import { Segmented } from "./form";

/* Tool output is untrusted: everything renders as text, media only from an allowlist of
   base64 data URIs, links only for http(s). */

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const RAW_STRING_LIMIT = 4000;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4);

function isHttp(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function asJson(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

/** Raw result with very long strings (base64 media) shortened. */
function rawJson(result: ToolRunResult): string {
  return JSON.stringify(
    result,
    (_key, value) =>
      typeof value === "string" && value.length > RAW_STRING_LIMIT
        ? `${value.slice(0, RAW_STRING_LIMIT)}… (${value.length - RAW_STRING_LIMIT} more characters)`
        : value,
    2,
  );
}

function TextPart({ text }: { text: string }) {
  const json = asJson(text);
  if (json) return <CodeBlock code={json} lang="json" maxHeight={420} />;
  return <pre className="out-text">{text}</pre>;
}

function UriLabel({ uri }: { uri: string }) {
  return isHttp(uri) ? (
    <ExternalA href={uri} className="link out-uri">
      {uri}
    </ExternalA>
  ) : (
    <code className="out-uri">{uri}</code>
  );
}

function MediaPart({
  kind,
  data,
  mimeType,
}: {
  kind: "image" | "audio";
  data: string;
  mimeType: string;
}) {
  const allowed = (kind === "image" ? IMAGE_TYPES : AUDIO_TYPES).has(mimeType);
  if (!allowed || !BASE64.test(data)) {
    return (
      <p className="out-note">
        {kind === "image" ? "Image" : "Audio"} ({mimeType || "unknown type"},{" "}
        {bytes(base64Bytes(data))}) can't be shown here. See the raw JSON.
      </p>
    );
  }
  const src = `data:${mimeType};base64,${data}`;
  return (
    <figure className="out-media">
      {kind === "image" ? (
        <img src={src} alt="Returned by the tool" className="out-image" />
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: tool audio has no captions to offer.
        <audio src={src} controls className="out-audio" />
      )}
      <figcaption className="out-note">
        {mimeType} · {bytes(base64Bytes(data))}
      </figcaption>
    </figure>
  );
}

function Part({ item }: { item: ToolContent }) {
  const any = item as Record<string, unknown>;
  switch (item.type) {
    case "text":
      return <TextPart text={String(any.text ?? "")} />;
    case "image":
    case "audio":
      return (
        <MediaPart
          kind={item.type}
          data={String(any.data ?? "")}
          mimeType={String(any.mimeType ?? "")}
        />
      );
    case "resource": {
      const resource = (any.resource ?? {}) as {
        uri?: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
      return (
        <div className="out-resource">
          <div className="out-resource-head">
            <Badge tone="blue" icon={FileCode}>
              Resource
            </Badge>
            {resource.uri && <UriLabel uri={resource.uri} />}
            {resource.mimeType && <span className="out-note">{resource.mimeType}</span>}
          </div>
          {typeof resource.text === "string" ? (
            <TextPart text={resource.text} />
          ) : typeof resource.blob === "string" ? (
            <p className="out-note">Binary data, {bytes(base64Bytes(resource.blob))}</p>
          ) : null}
        </div>
      );
    }
    case "resource_link":
      return (
        <div className="out-resource">
          <div className="out-resource-head">
            <Badge tone="teal" icon={LinkIcon}>
              Link
            </Badge>
            {typeof any.name === "string" && <strong>{any.name}</strong>}
            {typeof any.uri === "string" && <UriLabel uri={any.uri} />}
            {typeof any.mimeType === "string" && <span className="out-note">{any.mimeType}</span>}
          </div>
        </div>
      );
    default:
      return (
        <CodeBlock
          code={JSON.stringify(item, null, 2)}
          lang="json"
          title={`${String(item.type)} content`}
          maxHeight={320}
        />
      );
  }
}

type View = "result" | "raw";

/** Result of a tool call: text, JSON, images, audio and resources, plus the raw JSON. */
export function ToolOutput({ result, ms }: { result: ToolRunResult; ms?: number }) {
  const [view, setView] = useState<View>("result");
  const failed = result.isError === true;
  const parts = (Array.isArray(result.content) ? result.content : []).map((item, index) => ({
    id: `${index}-${String(item?.type)}`,
    item,
  }));
  const structured = result.structuredContent;

  return (
    <section className={cx("out", failed && "is-error")} aria-label="Tool output">
      <header className="out-head">
        <Badge tone={failed ? "red" : "green"} icon={failed ? CircleAlert : CircleCheck}>
          {failed ? "Tool error" : "Success"}
        </Badge>
        {ms !== undefined && <span className="out-ms">{duration(ms)}</span>}
        <Segmented<View>
          className="out-view"
          label="Output view"
          options={[
            { key: "result", label: "Result" },
            { key: "raw", label: "Raw JSON" },
          ]}
          value={view}
          onChange={setView}
        />
      </header>
      {view === "raw" ? (
        <CodeBlock code={rawJson(result)} lang="json" title="Response" maxHeight={480} />
      ) : (
        <div className="out-body">
          {parts.map(({ id, item }) => (
            <Part key={id} item={item} />
          ))}
          {structured !== undefined && (
            <CodeBlock
              code={JSON.stringify(structured, null, 2)}
              lang="json"
              title="Structured content"
              maxHeight={420}
            />
          )}
          {!parts.length && structured === undefined && (
            <p className="out-note">The tool returned no content.</p>
          )}
        </div>
      )}
    </section>
  );
}
