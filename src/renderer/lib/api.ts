// `unwrap` and the error class live in result.ts so code without a window (and its tests) can use them.
export { AppErrorException, unwrap } from './result';

export const api = () => window.devtalk;

/** One id per user action; reuse it to make a repeated click a no-op. */
export const newRequestId = (): string => crypto.randomUUID();
