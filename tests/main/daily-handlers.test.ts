import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChallengeCategory } from '../../src/core/domain/categories';
import { LLMError } from '../../src/core/llm/errors';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import type { LLMProvider, LLMRequest } from '../../src/core/llm/provider';
import type { ProgressStage } from '../../src/core/llm/structured';
import { newCard, rate } from '../../src/core/srs/srs';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import { createDailyStore } from '../../src/main/daily/store';
import { createDailyHandlers } from '../../src/main/ipc/daily-handlers';
import { createHandlers, type HandlerDeps } from '../../src/main/ipc/handlers';
import { createInFlight } from '../../src/main/ipc/in-flight';
import type { KeyVault } from '../../src/main/vault/key-vault';

const prompt = (name: string) => readFileSync(join(__dirname, '../../prompts', name), 'utf8');
const templates = () => ({ coach: prompt('coach.md'), challenge: prompt('challenge.md'), check: prompt('check.md') });
const profile = {
  nativeLanguage: 'Portuguese', currentLevel: 'B1' as const, targetLevel: 'B2' as const, explanationLanguage: 'Portuguese',
  provider: 'anthropic', model: 'claude-opus-5-5', theme: 'system' as const,
};
const SAO_PAULO = 'America/Sao_Paulo';

/** Echoes the category the generator asked for, like the real coach must. */
const challengeReply = (req: LLMRequest) =>
  JSON.stringify({
    category: /for the category "(\w+)"/.exec(req.system)![1],
    situation: 'A situation.', interlocutor: 'Maya, your manager', task: 'Say what happened.', required_expressions: [], summary: 'the situation',
  });

function memoryVault(initial: string | null = 'sk-ant-test'): KeyVault {
  let key = initial;
  return { has: () => key !== null, get: () => key, set: (k) => { key = k.trim(); }, clear: () => { key = null; } };
}

/** A promise the test opens by hand: a coach that answers when told to. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devtalk-daily-handlers-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Opts {
  provider?: LLMProvider;
  vault?: KeyVault;
  onboarded?: boolean;
  timeZone?: string;
  /** The clock starts here (12:00 on 4 November in São Paulo by default). */
  now?: string;
  on?: boolean;
  /** Reuse an earlier test's study store and daily file (an app restart). */
  store?: MemoryStudyStore;
}

function setup(opts: Opts = {}) {
  const store = opts.store ?? new MemoryStudyStore();
  if (opts.onboarded !== false && !store.getProfile()) store.saveProfile(profile, new Date('2026-10-01T12:00:00.000Z'));
  const provider = opts.provider ?? new FakeProvider([]);
  const progress: [string, ProgressStage][] = [];
  const emitProgress = (requestId: string, stage: ProgressStage) => progress.push([requestId, stage]);
  const time = { now: new Date(opts.now ?? '2026-11-04T15:00:00.000Z'), rng: 0 };
  const onChanged = vi.fn();
  const dailyStore = createDailyStore({ filePath: join(dir, 'daily.json') });
  if (opts.on !== false) dailyStore.update({ enabled: true });
  const inFlight = createInFlight(emitProgress);
  const deps: HandlerDeps = {
    store,
    vaults: () => opts.vault ?? memoryVault(),
    clock: { now: () => time.now },
    makeProvider: (apiKey) => {
      if (!apiKey) throw new LLMError('no_key', 'no key');
      return provider;
    },
    checkProvider: async () => ({ ok: true, detail: 'ok' }),
    templates,
    emitProgress,
    rng: () => time.rng,
    timeZone: () => opts.timeZone ?? SAO_PAULO,
  };
  const h = createDailyHandlers({ ...deps, inFlight, daily: { store: dailyStore, onChanged } });
  // The core group shares the registry, as in the app: challenges:cancel ends a daily:start.
  const core = createHandlers({ ...deps, inFlight });
  return { h, core, store, dailyStore, provider, time, onChanged, progress };
}
type Setup = ReturnType<typeof setup>;

/** An answer saved at this moment (a day of practice). */
function answerAt(store: MemoryStudyStore, iso: string) {
  store.saveFeedback({
    attempt: { challengeId: null, text: 'I fixed it.', source: 'typed' },
    feedback: { naturalRewrite: 'I fixed it.', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
    corrections: [], newExpressions: [], checks: [], initialCard: newCard(new Date(iso)), now: new Date(iso),
  });
}

/** A review rated at this moment. */
function reviewAt(store: MemoryStudyStore, iso: string) {
  const when = new Date(iso);
  const { expression } = store.saveExpression(
    { text: 'track down', normalizedText: 'track down', type: 'phrasal_verb', meaning: 'find', example: 'We track down bugs.' }, newCard(when), when,
  );
  const next = rate(newCard(when), 'good', when);
  store.saveReview(expression.id, next.card, next.log);
}

const today = async (s: Setup) => {
  const r = await s.h['daily:today']({});
  if (!r.ok) throw new Error(`daily:today failed: ${r.error.message}`);
  if (!r.data) throw new Error('daily:today is off');
  return r.data;
};
/** A challenge of this category, as if the person had asked for one. */
const addChallenge = (store: MemoryStudyStore, category: ChallengeCategory, at = '2026-11-04T10:00:00.000Z') =>
  store.saveChallenge({ category, situation: 's', interlocutor: 'i', task: 't', summary: `s ${category}`, required: [] }, new Date(at));

describe('daily:today', () => {
  test('daily:today is null while off', async () => {
    const s = setup({ on: false });
    expect(await s.h['daily:today']({})).toEqual({ ok: true, data: null });
    // Asking while off chooses and stores nothing.
    expect(s.dailyStore.get().pick).toBeNull();
    // It does not reach the coach either.
    expect((s.provider as FakeProvider).calls).toHaveLength(0);
  });

  test('the first call of a day stores a category and the second returns the same one even when the recent challenges and the rng changed', async () => {
    const s = setup();
    const first = await s.h['daily:today']({});
    // Empty history, rng 0: the first of the least used is the stand-up.
    expect(first).toEqual({
      ok: true,
      data: { day: '2026-11-04', category: 'daily_update', theme: 'Stand-up update', streak: 0, practisedToday: false, challengeId: null },
    });
    expect(s.dailyStore.get().pick).toEqual({ day: '2026-11-04', category: 'daily_update', challengeId: null });

    // Now pickCategory alone would choose something else: the stand-up is used up and the tie-breaker moved.
    addChallenge(s.store, 'daily_update');
    addChallenge(s.store, 'daily_update', '2026-11-04T11:00:00.000Z');
    s.time.rng = 0.99;
    s.time.now = new Date('2026-11-04T20:00:00.000Z');
    expect(await s.h['daily:today']({})).toEqual(first);
    expect(await s.h['daily:today']({})).toEqual(first);
    // The coach was never asked: the theme is chosen without it.
    expect((s.provider as FakeProvider).calls).toHaveLength(0);

    // The pick is on disk: a new store (the app opened again) reads the same one.
    const restarted = setup({ store: s.store });
    restarted.time.rng = 0.5;
    expect(await restarted.h['daily:today']({})).toEqual(first);
  });

  test('a new local day picks again', async () => {
    // São Paulo is UTC-3 all year: 02:30Z is 23:30 on the 4th, 03:30Z is 00:30 on the 5th.
    const s = setup({ now: '2026-11-05T02:30:00.000Z' });
    expect(await today(s)).toMatchObject({ day: '2026-11-04', category: 'daily_update', theme: 'Stand-up update' });

    // Things change, but the day does not: still the 4th, still the same pick, up to the last millisecond.
    addChallenge(s.store, 'daily_update');
    s.time.now = new Date('2026-11-05T02:59:59.999Z');
    expect(await today(s)).toMatchObject({ day: '2026-11-04', category: 'daily_update' });

    // Midnight in São Paulo: a new day picks again (the stand-up was used, so the first of the others).
    s.time.now = new Date('2026-11-05T03:00:00.000Z');
    expect(await today(s)).toMatchObject({ day: '2026-11-05', category: 'code_review', theme: 'Code review', challengeId: null });
    s.time.now = new Date('2026-11-05T03:30:00.000Z');
    addChallenge(s.store, 'code_review', '2026-11-05T03:10:00.000Z');
    s.time.rng = 0.99;
    expect(await today(s)).toMatchObject({ day: '2026-11-05', category: 'code_review' });
    expect(s.dailyStore.get().pick).toEqual({ day: '2026-11-05', category: 'code_review', challengeId: null });
  });

  test('the day is the local day of the zone, not UTC', async () => {
    // 12:00 UTC on the 13th is still the 13th in São Paulo and already the 14th in Auckland.
    for (const [timeZone, day] of [[SAO_PAULO, '2026-10-13'], ['Pacific/Auckland', '2026-10-14']] as const) {
      const s = setup({ now: '2026-10-13T12:00:00.000Z', timeZone });
      expect(await today(s)).toMatchObject({ day });
      rmSync(join(dir, 'daily.json'), { force: true });
    }
  });

  test('daily:today reports the streak (answers yesterday and the day before → 2, plus today → 3) and practisedToday', async () => {
    // 12:00 on the 5th in São Paulo; the answers are at midday on the 3rd and the 4th.
    const s = setup({ now: '2026-11-05T15:00:00.000Z' });
    expect(await today(s)).toMatchObject({ streak: 0, practisedToday: false });
    // One answer two days ago is no streak: yesterday is empty.
    answerAt(s.store, '2026-11-03T15:00:00.000Z');
    expect(await today(s)).toMatchObject({ streak: 0, practisedToday: false });
    answerAt(s.store, '2026-11-04T15:00:00.000Z');
    expect(await today(s)).toMatchObject({ streak: 2, practisedToday: false });
    answerAt(s.store, '2026-11-05T15:00:00.000Z');
    expect(await today(s)).toMatchObject({ day: '2026-11-05', streak: 3, practisedToday: true });
  });

  test('a review counts like an answer, a gap ends the streak, and answers late at night belong to their local day', async () => {
    const s = setup({ now: '2026-11-05T15:00:00.000Z' });
    reviewAt(s.store, '2026-11-05T14:00:00.000Z');
    expect(await today(s)).toMatchObject({ streak: 1, practisedToday: true });

    const gap = setup({ now: '2026-11-05T15:00:00.000Z', store: new MemoryStudyStore() });
    answerAt(gap.store, '2026-11-01T15:00:00.000Z');
    answerAt(gap.store, '2026-11-02T15:00:00.000Z');
    // Nothing on the 3rd: the run of two is over; the 4th is a new run of one that ends yesterday.
    answerAt(gap.store, '2026-11-04T15:00:00.000Z');
    expect(await today(gap)).toMatchObject({ streak: 1, practisedToday: false });

    // 01:00Z on the 5th is 22:00 on the 4th in São Paulo: it is the 4th's practice, not the 5th's.
    const late = setup({ now: '2026-11-05T15:00:00.000Z', store: new MemoryStudyStore() });
    answerAt(late.store, '2026-11-05T01:00:00.000Z');
    expect(await today(late)).toMatchObject({ streak: 1, practisedToday: false });
  });

  test('the payload is checked', async () => {
    const s = setup();
    expect(await s.h['daily:today']({ extra: 1 })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });
});

describe('daily:start', () => {
  test('daily:start writes one challenge in the stored category, links it to the day and returns it; a second call returns the same challenge without a coach call', async () => {
    const provider = new FakeProvider([challengeReply, challengeReply]);
    const s = setup({ provider });
    const picked = await today(s);
    expect(picked.category).toBe('daily_update');

    // pickCategory would now choose differently; the stored pick is what counts.
    addChallenge(s.store, 'daily_update');
    s.time.rng = 0.99;

    const first = await s.h['daily:start']({ requestId: 'd1' });
    expect(first).toMatchObject({ ok: true, data: { category: 'daily_update', situation: 'A situation.', summary: 'the situation' } });
    if (!first.ok) throw new Error('unreachable');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toContain('for the category "daily_update"');
    expect(provider.calls[0]!.schemaName).toBe('challenge');
    // The coach was asked once, and its challenge is the newest one the store has.
    expect(s.store.recentChallenges(10)).toHaveLength(2);
    expect(s.store.pendingChallenge()).toEqual(first.data);
    // Linked to the day, on the card and on disk.
    expect(await today(s)).toMatchObject({ category: 'daily_update', challengeId: first.data.id });
    expect(s.dailyStore.get().pick).toEqual({ day: '2026-11-04', category: 'daily_update', challengeId: first.data.id });
    expect(s.progress.filter(([id]) => id === 'd1').map(([, stage]) => stage)).toEqual(['sending', 'waiting', 'validating']);

    // Again: the same challenge, no coach call, nothing new saved, whatever the request id.
    expect(await s.h['daily:start']({ requestId: 'd2' })).toEqual(first);
    expect(await s.h['daily:start']({ requestId: 'd1' })).toEqual(first);
    expect(provider.calls).toHaveLength(1);
    expect(s.store.recentChallenges(10)).toHaveLength(2);

    // After the app was closed and opened on the same data: the same challenge again.
    const restarted = setup({ store: s.store, provider: new FakeProvider([]) });
    expect(await today(restarted)).toMatchObject({ category: 'daily_update', challengeId: first.data.id });
    expect(await restarted.h['daily:start']({ requestId: 'd3' })).toEqual(first);
    expect((restarted.provider as FakeProvider).calls).toHaveLength(0);
  });

  test('an answered daily challenge is still the day\'s challenge', async () => {
    const s = setup({ provider: new FakeProvider([challengeReply]) });
    const started = await s.h['daily:start']({ requestId: 'd1' });
    if (!started.ok) throw new Error('unreachable');
    s.store.saveFeedback({
      attempt: { challengeId: started.data.id, text: 'I fixed it.', source: 'typed' },
      feedback: { naturalRewrite: 'I fixed it.', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
      corrections: [], newExpressions: [], checks: [], initialCard: newCard(s.time.now), now: s.time.now,
    });
    expect(s.store.pendingChallenge()).toBeNull();
    expect(await s.h['daily:start']({ requestId: 'd2' })).toEqual(started);
  });

  test('the first start of a day can be the first call: it stores the pick itself', async () => {
    const s = setup({ provider: new FakeProvider([challengeReply]) });
    expect(s.dailyStore.get().pick).toBeNull();
    const r = await s.h['daily:start']({ requestId: 'd1' });
    expect(r).toMatchObject({ ok: true, data: { category: 'daily_update' } });
    expect(s.dailyStore.get().pick).toMatchObject({ day: '2026-11-04', category: 'daily_update', challengeId: expect.any(Number) });
  });

  test('a start works while the challenge is off (a notice clicked after turning it off) and keeps the setting', async () => {
    const s = setup({ on: false, provider: new FakeProvider([challengeReply]) });
    expect(await s.h['daily:start']({ requestId: 'd1' })).toMatchObject({ ok: true });
    expect(s.dailyStore.get().enabled).toBe(false);
    // The card still exists only while on.
    expect(await s.h['daily:today']({})).toEqual({ ok: true, data: null });
  });

  test('a second daily:start while the first runs → busy and one challenge saved', async () => {
    const g = gate();
    const provider = new FakeProvider([async (req) => { await g.opened; return challengeReply(req); }, challengeReply]);
    const s = setup({ provider });
    const first = s.h['daily:start']({ requestId: 'a' });
    // Another id (another window, a screen opened twice), and the same id again.
    expect(await s.h['daily:start']({ requestId: 'b' })).toMatchObject({ ok: false, error: { kind: 'busy' } });
    expect(await s.h['daily:start']({ requestId: 'a' })).toMatchObject({ ok: false, error: { kind: 'busy' } });
    g.open();
    expect(await first).toMatchObject({ ok: true });
    expect(s.store.recentChallenges(10)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    // Done: the next start is the stored challenge, not busy.
    expect(await s.h['daily:start']({ requestId: 'c' })).toMatchObject({ ok: true });
    expect(provider.calls).toHaveLength(1);
  });

  test('no key → no_key, a quota error → rate_limited, and the pick keeps challengeId null; cancel → cancelled', async () => {
    const noKey = setup({ vault: memoryVault(null) });
    expect(await noKey.h['daily:start']({ requestId: 'k1' })).toMatchObject({
      ok: false, error: { kind: 'no_key', message: 'Add your API key in Settings to use the coach.' },
    });
    expect(await today(noKey)).toMatchObject({ category: 'daily_update', challengeId: null });

    const quota = setup({ provider: new FakeProvider([() => { throw new LLMError('rate_limited', 'quota'); }]) });
    expect(await quota.h['daily:start']({ requestId: 'q1' })).toMatchObject({ ok: false, error: { kind: 'rate_limited', message: expect.stringContaining('limit') } });
    expect(await today(quota)).toMatchObject({ category: 'daily_update', challengeId: null });
    expect(quota.store.recentChallenges(10)).toEqual([]);

    const g = gate();
    const provider = new FakeProvider([async (req) => { await g.opened; return challengeReply(req); }, challengeReply]);
    const s = setup({ provider });
    const pending = s.h['daily:start']({ requestId: 'c1' });
    expect(await s.core['challenges:cancel']({ requestId: 'c1' })).toEqual({ ok: true, data: null });
    g.open();
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    expect(provider.calls[0]!.signal.aborted).toBe(true);
    expect(s.store.recentChallenges(10)).toEqual([]);
    expect(await today(s)).toMatchObject({ challengeId: null });
    // Start works again, and the failed tries left nothing behind.
    expect(await s.h['daily:start']({ requestId: 'c2' })).toMatchObject({ ok: true, data: { category: 'daily_update' } });
    expect(s.store.recentChallenges(10)).toHaveLength(1);
  });

  test('a failed try can be repeated, and after the key is back the same day gets its challenge', async () => {
    const vault = memoryVault(null);
    const provider = new FakeProvider([challengeReply]);
    const s = setup({ vault, provider });
    expect(await s.h['daily:start']({ requestId: 'k1' })).toMatchObject({ ok: false, error: { kind: 'no_key' } });
    vault.set('sk-ant-new');
    expect(await s.h['daily:start']({ requestId: 'k2' })).toMatchObject({ ok: true, data: { category: 'daily_update' } });
    expect(provider.calls).toHaveLength(1);
  });

  test('Start works again straight after a cancel, even before the cancelled call has finished', async () => {
    const stuck = gate();
    const provider = new FakeProvider([async (req) => { await stuck.opened; return challengeReply(req); }, challengeReply]);
    const s = setup({ provider });
    const first = s.h['daily:start']({ requestId: 'e1' });
    await s.core['challenges:cancel']({ requestId: 'e1' });
    // The first call is aborted but still waiting for the coach; a new Start must not be told "busy".
    const second = await s.h['daily:start']({ requestId: 'e2' });
    expect(second).toMatchObject({ ok: true, data: { category: 'daily_update' } });
    if (!second.ok) throw new Error('unreachable');
    // The aborted call ends as cancelled and saves nothing; the day keeps the second challenge.
    stuck.open();
    expect(await first).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    expect(s.store.recentChallenges(10)).toHaveLength(1);
    expect(await today(s)).toMatchObject({ challengeId: second.data.id });
    // And a third start is the stored one.
    expect(await s.h['daily:start']({ requestId: 'e3' })).toEqual(second);
  });

  test('a challenge that was linked and is gone is written again, in the same category', async () => {
    const s = setup({ provider: new FakeProvider([challengeReply]) });
    await today(s);
    s.dailyStore.update({ pick: { day: '2026-11-04', category: 'bug_explanation', challengeId: 999 } });
    const r = await s.h['daily:start']({ requestId: 'g1' });
    expect(r).toMatchObject({ ok: true, data: { category: 'bug_explanation' } });
    if (!r.ok) throw new Error('unreachable');
    expect(r.data.id).not.toBe(999);
    expect(s.dailyStore.get().pick).toEqual({ day: '2026-11-04', category: 'bug_explanation', challengeId: r.data.id });
  });

  test('a start that ends after midnight does not put its challenge on the new day', async () => {
    const g = gate();
    const provider = new FakeProvider([async (req) => { await g.opened; return challengeReply(req); }]);
    // 23:59 on the 4th in São Paulo.
    const s = setup({ provider, now: '2026-11-05T02:59:00.000Z' });
    const pending = s.h['daily:start']({ requestId: 'm1' });
    // Midnight passes while the coach writes; the card asks again and gets the new day's own pick.
    s.time.now = new Date('2026-11-05T03:01:00.000Z');
    s.time.rng = 0.5;
    const next = await today(s);
    expect(next).toMatchObject({ day: '2026-11-05', challengeId: null });
    g.open();
    const r = await pending;
    expect(r).toMatchObject({ ok: true, data: { category: 'daily_update' } });
    // The new day has not been given the old day's challenge.
    expect(s.dailyStore.get().pick).toEqual({ day: '2026-11-05', category: next.category, challengeId: null });
  });

  test('not onboarded → not_found; a bad payload → validation, and the coach is not reached', async () => {
    const provider = new FakeProvider([challengeReply]);
    const notOnboarded = setup({ onboarded: false, provider });
    expect(await notOnboarded.h['daily:start']({ requestId: 'n1' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });

    const s = setup({ provider });
    expect(await s.h['daily:start']({})).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await s.h['daily:start']({ requestId: '' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await s.h['daily:start']({ requestId: 'x', category: 'code_review' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(provider.calls).toHaveLength(0);
  });
});

describe('daily:settings and daily:setSettings', () => {
  test('daily:settings gives the switch and the time, off at 19:00 by default', async () => {
    const s = setup({ on: false });
    expect(await s.h['daily:settings']({})).toEqual({ ok: true, data: { enabled: false, time: '19:00' } });
    expect(await s.h['daily:settings']({ extra: 1 })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('daily:setSettings saves a valid time, refuses 24:00, and calls onChanged once per change', async () => {
    const s = setup({ on: false });
    expect(await s.h['daily:setSettings']({ enabled: true })).toEqual({ ok: true, data: { enabled: true, time: '19:00' } });
    expect(s.onChanged).toHaveBeenCalledTimes(1);
    expect(await s.h['daily:setSettings']({ time: '08:30' })).toEqual({ ok: true, data: { enabled: true, time: '08:30' } });
    expect(s.onChanged).toHaveBeenCalledTimes(2);

    // 24:00 and the rest of the wrong shapes: refused, nothing saved, nobody told.
    for (const time of ['24:00', '25:99', '19:60', '7:30', '19:0', '19:00:00', '', ' 19:00', 'noon']) {
      expect(await s.h['daily:setSettings']({ time }), time).toMatchObject({ ok: false, error: { kind: 'validation' } });
    }
    expect(await s.h['daily:setSettings']({ enabled: 'yes' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await s.h['daily:setSettings']({ loud: true })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await s.h['daily:settings']({})).toEqual({ ok: true, data: { enabled: true, time: '08:30' } });
    expect(s.onChanged).toHaveBeenCalledTimes(2);

    // Both at once is one change; the edges of the day are fine.
    expect(await s.h['daily:setSettings']({ enabled: false, time: '00:00' })).toEqual({ ok: true, data: { enabled: false, time: '00:00' } });
    expect(s.onChanged).toHaveBeenCalledTimes(3);
    expect(await s.h['daily:setSettings']({ time: '23:59' })).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
    expect(s.onChanged).toHaveBeenCalledTimes(4);

    // Saying what is already so is no change.
    expect(await s.h['daily:setSettings']({ time: '23:59' })).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
    expect(await s.h['daily:setSettings']({ enabled: false, time: '23:59' })).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
    expect(await s.h['daily:setSettings']({})).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
    expect(s.onChanged).toHaveBeenCalledTimes(4);

    // It is on disk: the next run of the app sees it.
    expect(setup({ on: false }).dailyStore.get()).toMatchObject({ enabled: false, time: '23:59' });
  });

  test('turning it on then off keeps the day\'s pick, and the settings do not touch the notice', async () => {
    const s = setup({ on: false });
    await s.h['daily:setSettings']({ enabled: true });
    const picked = await today(s);
    s.dailyStore.update({ lastNotifiedDay: '2026-11-03' });
    await s.h['daily:setSettings']({ enabled: false });
    await s.h['daily:setSettings']({ enabled: true, time: '07:00' });
    expect(await today(s)).toEqual(picked);
    expect(s.dailyStore.get().lastNotifiedDay).toBe('2026-11-03');
  });

  test('a hook that throws does not undo or fail the change', async () => {
    const s = setup({ on: false });
    s.onChanged.mockImplementation(() => { throw new Error('reschedule failed'); });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await s.h['daily:setSettings']({ enabled: true })).toEqual({ ok: true, data: { enabled: true, time: '19:00' } });
    expect(s.dailyStore.get().enabled).toBe(true);
    quiet.mockRestore();
  });
});
