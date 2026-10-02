import { Braces, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { isSecretKey } from "../lib/format";
import type { JsonSchema } from "../lib/types";
import { Checkbox, Field, SecretInput, Segmented, Select, TextArea, TextInput } from "./form";

/** Form state: text for every field except booleans. */
export type Draft = Record<string, string | boolean>;

type Kind = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export type EditorMode = "form" | "json";

const LONG_TEXT = /code|script|content|body|text|prompt|query|sql|markdown|html|message/i;

/** Unwraps `anyOf: [X, {type: "null"}]` (how Python servers declare optional fields). */
function unwrap(schema: JsonSchema): JsonSchema {
  const variants = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  if (!Array.isArray(variants)) return schema;
  const real = variants.filter((v) => v && v.type !== "null");
  if (real.length !== 1) return schema;
  const { anyOf: _a, oneOf: _o, ...rest } = schema;
  return { ...real[0], ...rest };
}

function typeOf(schema: JsonSchema): string | undefined {
  const t = schema.type;
  return Array.isArray(t) ? t.find((x) => x !== "null") : t;
}

function fieldKind(schema: JsonSchema): Kind {
  const values = schema.enum;
  if (
    Array.isArray(values) &&
    values.length &&
    values.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))
  ) {
    return "enum";
  }
  const t = typeOf(schema);
  return t === "string" || t === "number" || t === "integer" || t === "boolean" ? t : "json";
}

function fields(schema: JsonSchema | undefined): [string, JsonSchema, Kind][] {
  return Object.entries(schema?.properties ?? {}).map(([name, raw]) => {
    const prop = unwrap(raw ?? {});
    return [name, prop, fieldKind(prop)];
  });
}

function defaults(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of fields(schema)) {
    if (prop.default !== undefined && prop.default !== null) out[name] = prop.default;
  }
  return out;
}

function draftFromArgs(schema: JsonSchema | undefined, args: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const [name, , kind] of fields(schema)) {
    const value = args[name];
    if (kind === "boolean") draft[name] = value === true;
    else if (value === undefined || value === null) draft[name] = "";
    else if (kind === "enum") draft[name] = JSON.stringify(value);
    else if (kind === "json") draft[name] = JSON.stringify(value, null, 2);
    else draft[name] = String(value);
  }
  return draft;
}

/** Turns the form into tool arguments; empty optional fields are left out. */
function buildArgs(
  schema: JsonSchema | undefined,
  draft: Draft,
): { args: Record<string, unknown>; errors: Record<string, string> } {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const required = new Set(schema?.required ?? []);

  for (const [name, prop, kind] of fields(schema)) {
    const value = draft[name];
    if (kind === "boolean") {
      if (value === true || required.has(name) || prop.default !== undefined) {
        args[name] = value === true;
      }
      continue;
    }
    const text = typeof value === "string" ? value : "";
    if (kind === "string" ? text === "" : !text.trim()) {
      if (required.has(name)) errors[name] = "Required";
      continue;
    }

    if (kind === "string") {
      args[name] = text;
    } else if (kind === "enum") {
      args[name] = JSON.parse(text);
    } else if (kind === "number" || kind === "integer") {
      const n = Number(text.trim());
      const { minimum, maximum } = prop;
      if (!Number.isFinite(n)) errors[name] = "Enter a number";
      else if (kind === "integer" && !Number.isInteger(n)) errors[name] = "Enter a whole number";
      else if (typeof minimum === "number" && n < minimum) errors[name] = `At least ${minimum}`;
      else if (typeof maximum === "number" && n > maximum) errors[name] = `At most ${maximum}`;
      else args[name] = n;
    } else {
      const t = typeOf(prop);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Untyped fields also take plain text.
        if (t === undefined) args[name] = text;
        else errors[name] = "Invalid JSON";
        continue;
      }
      if (t === "array" && !Array.isArray(parsed)) errors[name] = "Must be a JSON array";
      else if (t === "object" && !isObject(parsed)) errors[name] = "Must be a JSON object";
      else args[name] = parsed;
    }
  }
  return { args, errors };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObject(parsed)) throw new Error("The input must be a JSON object, like {}");
  return parsed;
}

export interface ArgsEditor {
  schema: JsonSchema | undefined;
  mode: EditorMode;
  setMode(mode: EditorMode): void;
  draft: Draft;
  setField(name: string, value: string | boolean): void;
  json: string;
  setJson(text: string): void;
  errors: Record<string, string>;
  jsonError: string | undefined;
  /** Validates and returns the arguments, or null after showing the errors. */
  collect(): Record<string, unknown> | null;
  reset(): void;
}

/**
 * Form/JSON editor state for a tool's input schema. Without a schema only JSON is offered.
 * Mount it per tool (key the component by tool name) so the state resets between tools.
 */
export function useArgsEditor(schema: JsonSchema | undefined): ArgsEditor {
  const [mode, setModeState] = useState<EditorMode>(schema ? "form" : "json");
  const [draft, setDraft] = useState<Draft>(() => draftFromArgs(schema, defaults(schema)));
  const [json, setJsonState] = useState("{}");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string>();

  const setMode = (next: EditorMode) => {
    if (next === mode || !schema) return;
    if (next === "json") {
      setJsonState(JSON.stringify(buildArgs(schema, draft).args, null, 2));
      setErrors({});
      setJsonError(undefined);
      setModeState("json");
      return;
    }
    try {
      const args = parseObject(json);
      const known = new Set(Object.keys(schema.properties ?? {}));
      const extra = Object.keys(args).filter((key) => !known.has(key));
      if (extra.length) {
        throw new Error(`Not in the form: ${extra.join(", ")}. Remove them to switch back.`);
      }
      setDraft(draftFromArgs(schema, args));
      setJsonError(undefined);
      setModeState("form");
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    schema,
    mode,
    setMode,
    draft,
    setField(name, value) {
      setDraft((prev) => ({ ...prev, [name]: value }));
      setErrors((prev) => {
        if (!prev[name]) return prev;
        const { [name]: _, ...rest } = prev;
        return rest;
      });
    },
    json,
    setJson(text) {
      setJsonState(text);
      setJsonError(undefined);
    },
    errors,
    jsonError,
    collect() {
      if (mode === "json") {
        try {
          return parseObject(json);
        } catch (err) {
          setJsonError(err instanceof Error ? err.message : String(err));
          return null;
        }
      }
      const result = buildArgs(schema, draft);
      setErrors(result.errors);
      return Object.keys(result.errors).length ? null : result.args;
    },
    reset() {
      setDraft(draftFromArgs(schema, defaults(schema)));
      setJsonState("{}");
      setErrors({});
      setJsonError(undefined);
    },
  };
}

function typeLabel(prop: JsonSchema, kind: Kind): string {
  if (kind === "enum") return "choice";
  if (kind === "json") return typeOf(prop) ?? "any";
  return kind;
}

/** Inputs for a tool's arguments, generated from its JSON Schema, with a raw JSON mode. */
export function SchemaForm({ editor }: { editor: ArgsEditor }) {
  const baseId = useId();
  const { schema, mode, draft, errors } = editor;
  const list = fields(schema);
  const required = new Set(schema?.required ?? []);

  return (
    <div className="schema-form">
      {schema && (
        <div className="schema-form-head">
          <span className="schema-form-title">Input</span>
          <Segmented<EditorMode>
            label="Input mode"
            options={[
              { key: "form", label: "Form", icon: SlidersHorizontal },
              { key: "json", label: "JSON", icon: Braces },
            ]}
            value={mode}
            onChange={editor.setMode}
          />
        </div>
      )}

      {mode === "json" ? (
        <Field
          label={schema ? "Arguments as JSON" : "Input (JSON)"}
          htmlFor={`${baseId}-json`}
          error={editor.jsonError}
          hint={schema ? undefined : "This tool's input schema isn't known. Enter the arguments."}
        >
          <TextArea
            id={`${baseId}-json`}
            mono
            rows={8}
            spellCheck={false}
            value={editor.json}
            onChange={(event) => editor.setJson(event.target.value)}
            aria-invalid={editor.jsonError ? true : undefined}
            aria-describedby={editor.jsonError || !schema ? `${baseId}-json-hint` : undefined}
          />
        </Field>
      ) : list.length === 0 ? (
        <p className="schema-form-empty">This tool takes no input.</p>
      ) : (
        list.map(([name, prop, kind], index) => {
          const id = `${baseId}-${index}`;
          const error = errors[name];
          const description = prop.description || prop.title;
          const described = error || description ? `${id}-hint` : undefined;
          const label = (
            <>
              <code>{name}</code>
              <span className="field-type">{typeLabel(prop, kind)}</span>
            </>
          );
          const value = draft[name];
          const text = typeof value === "string" ? value : "";
          const set = (next: string | boolean) => editor.setField(name, next);

          if (kind === "boolean") {
            return (
              <Checkbox
                key={name}
                label={label}
                hint={description}
                checked={value === true}
                onChange={(event) => set(event.target.checked)}
              />
            );
          }

          const common = {
            id,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": described,
          };
          let control: ReactNode;
          if (kind === "enum") {
            control = (
              <Select {...common} value={text} onChange={(event) => set(event.target.value)}>
                <option value="">Choose…</option>
                {(prop.enum ?? []).map((option) => {
                  const encoded = JSON.stringify(option);
                  return (
                    <option key={encoded} value={encoded}>
                      {String(option)}
                    </option>
                  );
                })}
              </Select>
            );
          } else if (kind === "json") {
            control = (
              <TextArea
                {...common}
                mono
                rows={4}
                spellCheck={false}
                placeholder={typeOf(prop) === "array" ? "[]" : typeOf(prop) ? "{}" : ""}
                value={text}
                onChange={(event) => set(event.target.value)}
              />
            );
          } else if (kind === "number" || kind === "integer") {
            control = (
              <TextInput
                {...common}
                inputMode={kind === "integer" ? "numeric" : "decimal"}
                value={text}
                onChange={(event) => set(event.target.value)}
              />
            );
          } else if (isSecretKey(name)) {
            control = (
              <SecretInput {...common} value={text} onChange={(e) => set(e.target.value)} />
            );
          } else if (
            LONG_TEXT.test(name) ||
            (typeof prop.maxLength === "number" && prop.maxLength > 200)
          ) {
            control = (
              <TextArea
                {...common}
                rows={3}
                value={text}
                onChange={(event) => set(event.target.value)}
              />
            );
          } else {
            control = (
              <TextInput {...common} value={text} onChange={(event) => set(event.target.value)} />
            );
          }

          return (
            <Field
              key={name}
              label={label}
              htmlFor={id}
              hint={description}
              error={error}
              required={required.has(name)}
            >
              {control}
            </Field>
          );
        })
      )}
    </div>
  );
}
