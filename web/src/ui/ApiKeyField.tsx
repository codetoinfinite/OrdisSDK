import { useId } from "react";
import { apiKeyStore } from "../lib/api";
import { useStore } from "../lib/store";
import { Field, SecretInput } from "./form";

/** The AlpheSDK API key, sent with every request to this API and remembered on this device. */
export function ApiKeyField() {
  const apiKey = useStore(apiKeyStore);
  const id = useId();
  return (
    <Field
      label="AlpheSDK API key"
      htmlFor={id}
      hint="Required to run tools and connect clients. Sent with every request to AlpheSDK and remembered on this device. Ask the AlpheSDK admin for one."
    >
      <SecretInput
        id={id}
        aria-describedby={`${id}-hint`}
        value={apiKey}
        onChange={(event) => apiKeyStore.set(event.target.value.trim())}
      />
    </Field>
  );
}
