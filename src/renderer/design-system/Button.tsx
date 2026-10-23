import type { ButtonHTMLAttributes, Ref } from 'react';
import { Kbd } from './Kbd';

export function Button({
  variant,
  shortcut,
  busy = false,
  children,
  disabled,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: 'primary' | 'secondary' | 'quiet'; shortcut?: string; busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button {...rest} type={type} className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="btn-busy-dot" aria-hidden="true" />}
      {children}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}
