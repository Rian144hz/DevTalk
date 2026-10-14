import type { AppErrorKind } from '../../shared/ipc-contract';

/** What the person can do about an error: fix something in Settings, try again, or nothing. */
export function errorAction(kind: AppErrorKind): 'settings' | 'retry' | 'none' {
  switch (kind) {
    case 'no_key':
    case 'auth':
    case 'config':
    case 'keyring_unavailable':
      return 'settings';
    case 'cancelled':
      return 'none';
    default:
      return 'retry';
  }
}
