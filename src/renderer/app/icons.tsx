import type { ReactElement } from 'react';

// One stroke icon set (16px grid, 1.6 stroke), drawn for DevTalk.
const PATHS: Record<string, ReactElement> = {
  home: <><path d="M2.5 7.2 8 2.5l5.5 4.7V13.5h-11z" /><path d="M6.5 13.5v-4h3v4" /></>,
  practice: <><path d="M3 13l1.2-3.6L11 2.6l2.4 2.4-6.8 6.8z" /><path d="M9.6 4l2.4 2.4" /></>,
  review: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M5 6.5h6M5 9.5h4" /></>,
  people: <><circle cx="6" cy="6" r="2.4" /><path d="M2 13c.5-2.4 2-3.4 4-3.4s3.5 1 4 3.4M10.8 3.8a2.2 2.2 0 0 1 0 4.4M12.6 13c-.2-1.4-.8-2.3-1.6-2.8" /></>,
  rooms: <><rect x="6" y="2" width="4" height="7" rx="2" /><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" /></>,
  micOff: <><path d="M10 6.5V4a2 2 0 0 0-4 0v3.5M6.6 8.6A2 2 0 0 0 10 7.5" /><path d="M3.5 8a4.5 4.5 0 0 0 7.4 3.4M12.4 9a4.5 4.5 0 0 0 .1-1M8 12.5V14M2.5 2.5l11 11" /></>,
  progress: <path d="M2.5 13.5h11M4.5 11V8.5M8 11V4.5M11.5 11V6.5" />,
  settings: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" /></>,
  pencil: <><path d="M3 12.5 11.2 4.3l1.5 1.5L4.5 14H3z" /><path d="M10 5.5l1.5 1.5" /></>,
  check: <path d="M3 8.5 6.5 12 13 4.5" />,
  circle: <circle cx="8" cy="8" r="5" />,
  half: <><circle cx="8" cy="8" r="5" /><path d="M8 3v10" /></>,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" /></>,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  shield: <path d="M8 1.8 13 3.8v3.8c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.8z" />,
  heart: <path d="M8 13.5S2.5 10.2 2.5 6.2A2.9 2.9 0 0 1 8 4.6a2.9 2.9 0 0 1 5.5 1.6c0 4-5.5 7.3-5.5 7.3z" />,
  chat: <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}
