import type { AppErrorKind, Result } from '../../shared/ipc-contract';

export class AppErrorException extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AppErrorException';
  }
}

/** Turns an IPC Result into a value, or throws the friendly error the main process chose. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new AppErrorException(result.error.kind, result.error.message);
}
