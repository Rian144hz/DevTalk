import { TextChecker } from '../../core/check/checker';
import { findSecret, SECRET_MESSAGE } from '../../core/check/secrets';
import { CHECK_TEXT_MAX, checkText } from '../../core/check/types';
import { AppFailure, handle, type HandlerMap } from './handle';
import { providerFor, requireProfile, type CheckChannel, type HandlerDeps } from './handlers';
import type { InFlight } from './in-flight';

/**
 * Check text. The text goes to the coach the person chose and nowhere else: it is not stored, it does not count as
 * practice, and nothing is kept unless the person keeps an expression (review:keep).
 */
export function createCheckHandlers(deps: HandlerDeps & { inFlight: InFlight }): HandlerMap<CheckChannel> {
  const { store, inFlight } = deps;
  return {
    'check:run': handle('check:run', ({ requestId, type, text }) => {
      // The schema has refused a blank or too long text already; this keeps the trimmed text (and the rule) in one place.
      const body = checkText(text);
      if (body === null) throw new AppFailure('validation', `Write 1 to ${CHECK_TEXT_MAX} characters.`);
      // The window stops a key before it sends; this is the same rule for a call that skips the window. It comes before
      // the profile and the key, so the coach is never reached with one.
      if (findSecret(body)) throw new AppFailure('validation', SECRET_MESSAGE);
      const profile = requireProfile(store);
      const checker = new TextChecker({ provider: providerFor(deps, profile), template: deps.templates().check });
      return inFlight.run(requestId, (signal, onProgress) => checker.check({ type, text: body, learner: profile }, signal, onProgress));
    }),
    'check:cancel': handle('check:cancel', ({ requestId }) => {
      inFlight.cancel(requestId);
      return null;
    }),
  };
}
