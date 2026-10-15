import { CircleCheck, KeyRound, Lock } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { isSecretKey, plural } from "../lib/format";
import { envValues, isRemembered, missingKeys, setEnv, toast, useEnvValues } from "../lib/state";
import type { EnvVar } from "../lib/types";
import { Badge, Button, Callout } from "./core";
import { Checkbox, Field, SecretInput, TextInput } from "./form";

/** Keys (env vars) for one server, kept in this browser only. */
export function EnvForm({
  packageName,
  env,
  onSaved,
}: {
  packageName: string;
  env: Record<string, EnvVar>;
  onSaved?: () => void;
}) {
  const baseId = useId();
  const saved = useEnvValues(packageName);
  const [draft, setDraft] = useState<Record<string, string>>(() => envValues(packageName));
  const [remember, setRemember] = useState(() => isRemembered(packageName));
  const [dirty, setDirty] = useState(false);

  // Required first; Array.prototype.sort is stable, so the declared order holds otherwise.
  const names = Object.keys(env).sort(
    (a, b) => Number(Boolean(env[b].required)) - Number(Boolean(env[a].required)),
  );
  if (!names.length) {
    return (
      <Callout kind="success" title="No server keys needed">
        This server needs no keys of its own. Your AlpheSDK API key above is all it takes.
      </Callout>
    );
  }

  const missing = missingKeys(env, saved);
  const hasSaved = Object.values(saved).some((value) => value.trim());

  const save = (event: FormEvent) => {
    event.preventDefault();
    setEnv(packageName, draft, remember);
    setDirty(false);
    toast("Keys saved", {
      kind: "success",
      body: remember ? "Remembered on this device." : "Kept in this browser tab only.",
    });
    onSaved?.();
  };

  const clear = () => {
    setEnv(packageName, {}, false);
    setDraft({});
    setRemember(false);
    setDirty(false);
    toast("Keys cleared", { body: "Nothing is stored for this server now." });
  };

  return (
    <form className="env-form" onSubmit={save} noValidate autoComplete="off">
      <div className="env-status">
        {missing.length ? (
          <Badge tone="yellow" icon={KeyRound}>
            {plural(missing.length, "required key")} missing
          </Badge>
        ) : (
          <Badge tone="green" icon={CircleCheck}>
            All required keys set
          </Badge>
        )}
        {dirty && <span className="env-dirty">Unsaved changes</span>}
      </div>

      {names.map((name, index) => {
        const spec = env[name];
        const id = `${baseId}-${index}`;
        const hint = [spec.description, spec.default ? `Default: ${spec.default}` : ""]
          .filter(Boolean)
          .join(" ");
        const props = {
          id,
          value: draft[name] ?? "",
          placeholder: spec.default ?? (spec.required ? "Required" : "Optional"),
          "aria-describedby": hint ? `${id}-hint` : undefined,
          onChange: (event: { target: { value: string } }) => {
            setDraft((prev) => ({ ...prev, [name]: event.target.value }));
            setDirty(true);
          },
        };
        return (
          <Field
            key={name}
            label={<code>{name}</code>}
            htmlFor={id}
            hint={hint}
            required={spec.required && !spec.default}
          >
            {isSecretKey(name, spec) ? (
              <SecretInput {...props} />
            ) : (
              <TextInput {...props} autoComplete="off" spellCheck={false} />
            )}
          </Field>
        );
      })}

      <Checkbox
        label="Remember on this device"
        hint="Off: the keys are forgotten when this browser tab closes."
        checked={remember}
        onChange={(event) => {
          setRemember(event.target.checked);
          setDirty(true);
        }}
      />

      <p className="env-note">
        <Lock size={13} aria-hidden="true" />
        Keys stay in this browser. They go only to this AlpheSDK server, inside request bodies or
        headers, and never into URLs.
      </p>

      <div className="env-actions">
        <Button type="submit" variant="primary" icon={KeyRound}>
          Save keys
        </Button>
        {(hasSaved || dirty) && (
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
