import type { ReactNode } from 'react';

export function Notice({ tone, title, detail, action }: { tone: 'error' | 'info'; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <p><span className="notice-title">{title}</span>{detail && <span className="notice-detail">{detail}</span>}</p>
      {action}
    </div>
  );
}
