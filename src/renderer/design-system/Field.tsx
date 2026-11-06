import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldText {
  label: string;
  hint?: string;
  error?: string;
}

function described(id: string, hint?: string, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
}

function Wrap({ id, label, hint, error, children }: FieldText & { id: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="field-error" id={`${id}-error`} role="alert">{error}</span>}
    </div>
  );
}

export function TextField({ label, hint, error, className, ...rest }: FieldText & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <input {...rest} id={id} className={className ? `input ${className}` : 'input'} aria-invalid={error ? true : undefined} aria-describedby={described(id, hint, error)} />
    </Wrap>
  );
}

export const PasswordField = (props: FieldText & InputHTMLAttributes<HTMLInputElement>) => (
  <TextField {...props} type="password" autoComplete="off" spellCheck={false} />
);

export function TextArea({ label, hint, error, className, ...rest }: FieldText & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <textarea {...rest} id={id} className={className ? `textarea ${className}` : 'textarea'} aria-invalid={error ? true : undefined} aria-describedby={described(id, hint, error)} />
    </Wrap>
  );
}

export function Select({ label, hint, error, options, ...rest }: FieldText & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <select {...rest} id={id} className="select" aria-describedby={described(id, hint, error)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Wrap>
  );
}

/** A small radio group drawn as one control; arrow keys move the choice. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly { value: NoInfer<T>; label: string }[];
  onChange(v: NoInfer<T>): void;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className="field">
      <span className="field-label" id={id}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o, i) => (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio"
            aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1}
            onClick={() => onChange(o.value)} onKeyDown={(e) => move(e, i)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
