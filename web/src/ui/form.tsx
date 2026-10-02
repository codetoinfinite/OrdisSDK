import type { LucideIcon } from "lucide-react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { cx } from "../lib/format";
import { IconButton } from "./core";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  /** Id of the control; the hint gets `${htmlFor}-hint` for aria-describedby. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cx("field", className)}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={hintId}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={hintId}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export interface TextInputProps extends ComponentProps<"input"> {
  icon?: LucideIcon;
  /** Trailing content inside the box (buttons, badges). */
  end?: ReactNode;
  large?: boolean;
}

export function TextInput({ icon: Icon, end, large, className, ...rest }: TextInputProps) {
  return (
    <span className={cx("input", Icon && "has-icon", large && "input-lg", className)}>
      {Icon && <Icon size={large ? 18 : 16} className="input-icon" />}
      <input className="input-control" {...rest} />
      {end && <span className="input-end">{end}</span>}
    </span>
  );
}

/** Masked input with a show/hide toggle, for keys and passwords. */
export function SecretInput(props: Omit<TextInputProps, "type" | "end">) {
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      autoComplete="off"
      spellCheck={false}
      {...props}
      type={shown ? "text" : "password"}
      end={
        <IconButton
          icon={shown ? EyeOff : Eye}
          label={shown ? "Hide value" : "Show value"}
          size="sm"
          onClick={() => setShown((value) => !value)}
        />
      }
    />
  );
}

export function TextArea({
  mono,
  className,
  ...rest
}: ComponentProps<"textarea"> & { mono?: boolean }) {
  return <textarea className={cx("textarea", mono && "mono", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <span className={cx("select", className)}>
      <select {...rest}>{children}</select>
      <ChevronDown size={15} />
    </span>
  );
}

export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx("checkbox", className)}>
      <input type="checkbox" {...rest} />
      <span className="checkbox-text">
        <span className="checkbox-label">{label}</span>
        {hint && <span className="checkbox-hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface SegmentedOption<K extends string> {
  key: K;
  label: ReactNode;
  icon?: LucideIcon;
}

/** A small set of mutually exclusive toggle buttons. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: SegmentedOption<K>[];
  value: K;
  onChange(key: K): void;
  className?: string;
}) {
  return (
    <fieldset className={cx("segmented", className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            className="seg"
            aria-pressed={option.key === value}
            onClick={() => onChange(option.key)}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
