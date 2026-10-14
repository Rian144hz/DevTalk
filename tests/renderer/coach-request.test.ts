import type { Result } from '../../src/shared/ipc-contract';
import { createCoachRequestController, type CoachState } from '../../src/renderer/lib/coachRequest';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup() {
  const cancelled: string[] = [];
  const states: CoachState<string>[] = [];
  let n = 0;
  const c = createCoachRequestController<string>({
    cancel: (id) => cancelled.push(id),
    now: () => 1000,
    newId: () => `r${++n}`,
    onChange: (s) => states.push(s),
  });
  return { c, cancelled, states, last: () => states[states.length - 1]! };
}

const ok = (data: string): Result<string> => ({ ok: true, data });

test('run → running → done', async () => {
  const { c, last } = setup();
  const d = deferred<Result<string>>();
  c.run(() => d.promise);
  expect(last()).toEqual({ status: 'running', requestId: 'r1', stage: null, startedAt: 1000 });
  d.resolve(ok('x'));
  await d.promise;
  await Promise.resolve();
  expect(last()).toEqual({ status: 'done', data: 'x' });
});

test('progress events update only the running request', () => {
  const { c, last } = setup();
  c.run(() => new Promise(() => {}));
  c.progress('other', 'waiting');
  expect(last()).toMatchObject({ stage: null });
  c.progress('r1', 'waiting');
  expect(last()).toMatchObject({ stage: 'waiting' });
});

test('a second run cancels the first and ignores its late result', async () => {
  const { c, cancelled, last } = setup();
  const first = deferred<Result<string>>();
  c.run(() => first.promise);
  c.run(() => new Promise(() => {}));
  expect(cancelled).toEqual(['r1']);
  first.resolve(ok('late'));
  await first.promise;
  await Promise.resolve();
  expect(last()).toMatchObject({ status: 'running', requestId: 'r2' });
});

test('cancel calls deps.cancel once, goes idle, and ignores the late result', async () => {
  const { c, cancelled, last } = setup();
  const d = deferred<Result<string>>();
  c.run(() => d.promise);
  c.cancel();
  c.cancel();
  expect(cancelled).toEqual(['r1']);
  expect(last()).toEqual({ status: 'idle' });
  d.resolve(ok('late'));
  await d.promise;
  await Promise.resolve();
  expect(last()).toEqual({ status: 'idle' });
});

test('errors become the error state; a cancelled error goes idle', async () => {
  const { c, last } = setup();
  c.run(async () => ({ ok: false, error: { kind: 'rate_limited', message: 'limit' } }));
  await Promise.resolve(); await Promise.resolve();
  expect(last()).toMatchObject({ status: 'error', error: { kind: 'rate_limited', message: 'limit' } });
  c.run(async () => ({ ok: false, error: { kind: 'cancelled', message: 'Cancelled.' } }));
  await Promise.resolve(); await Promise.resolve();
  expect(last()).toEqual({ status: 'idle' });
});

test('dispose cancels a running request', () => {
  const { c, cancelled } = setup();
  c.run(() => new Promise(() => {}));
  c.dispose();
  expect(cancelled).toEqual(['r1']);
});
