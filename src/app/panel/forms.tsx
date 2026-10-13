"use client";

import { useActionState, type ReactNode } from "react";

export interface ActionStateLike {
  error?: string;
  message?: string;
}

interface ActionFormProps {
  action: (state: ActionStateLike, form: FormData) => Promise<ActionStateLike>;
  hidden?: Record<string, string | number | null | undefined>;
  children?: ReactNode;
  submitLabel: string;
  submitClass?: string;
  csrf: string;
  compact?: boolean;
}

/** فرم استاندارد با نمایش خطا/پیام موفقیت و توکن CSRF */
export function ActionForm({ action, hidden = {}, children, submitLabel, submitClass = "", csrf, compact = false }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, {} as ActionStateLike);
  return (
    <form action={formAction} style={compact ? { display: "inline" } : undefined}>
      <input type="hidden" name="_csrf" value={csrf} />
      {Object.entries(hidden).map(([key, value]) =>
        value === null || value === undefined ? null : <input key={key} type="hidden" name={key} value={String(value)} />,
      )}
      {!compact && state.error ? <div className="alert error">{state.error}</div> : null}
      {!compact && state.message ? <div className="alert success">{state.message}</div> : null}
      {children}
      <button type="submit" className={submitClass} disabled={pending} style={compact ? { marginRight: 6 } : undefined}>
        {pending ? "…" : submitLabel}
      </button>
      {compact && state.error ? <span className="small" style={{ color: "var(--danger)" }}> {state.error}</span> : null}
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  placeholder,
  options,
  emptyLabel,
  min,
  step,
  rows,
  hint,
}: {
  label: string;
  name: string;
  type?: "text" | "number" | "date" | "password" | "select" | "textarea" | "datetime-local";
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  emptyLabel?: string;
  min?: number;
  step?: number;
  rows?: number;
  hint?: string;
}) {
  const id = `f-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint ? <span className="muted small"> — {hint}</span> : null}
      </label>
      {type === "select" ? (
        <select id={id} name={name} defaultValue={defaultValue === null || defaultValue === undefined ? "" : String(defaultValue)} required={required}>
          <option value="">{emptyLabel ?? "انتخاب کنید…"}</option>
          {(options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea id={id} name={name} defaultValue={defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)} placeholder={placeholder} required={required} rows={rows ?? 3} />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)}
          placeholder={placeholder}
          required={required}
          min={min}
          step={step}
        />
      )}
    </div>
  );
}

export function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={String(value)} />;
}
