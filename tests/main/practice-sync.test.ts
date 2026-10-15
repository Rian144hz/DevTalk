import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCard } from '../../src/core/srs/srs';
import type { SaveFeedbackInput } from '../../src/core/ports';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import type { SocialBackend } from '../../src/main/social/backend';
import { SocialError } from '../../src/main/social/errors';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';
import { createPracticeSync } from '../../src/main/social/practice-sync';

const NOW = new Date('2026-10-14T15:00:00Z');

function answer(store: MemoryStudyStore, when: Date, expressions = 0) {
  const input: SaveFeedbackInput = {
    attempt: { challengeId: null, text: 'I fixed it.', source: 'typed' },
    feedback: { naturalRewrite: 'I fixed it.', provider: 'fake', model: 'fake', latencyMs: 1, rawJson: '{}' },
    corrections: [],
    newExpressions: Array.from({ length: expressions }, (_, i) => ({
      text: `expr ${when.getTime()} ${i}`, normalizedText: `expr ${when.getTime()} ${i}`, type: 'chunk' as const, meaning: 'm', example: 'e',
    })),
    checks: [],
    initialCard: newCard(when),
    now: when,
  };
  store.saveFeedback(input);
}

const profileDraft = (timezone: string) => ({
  displayName: 'Rian', nativeLanguage: 'Portuguese (Brazil)', level: 'B1' as const, timezone, area: 'backend' as const,
  stack: [], availability: [], bio: '', mainStack: [], showProgress: true, mascot: null,
});

async function member(timezone = 'America/Sao_Paulo') {
  const backend = createFakeSocialBackend();
  await backend.sendCode('rian@example.com');
  await backend.verifyCode('rian@example.com', '123456');
  await backend.acceptDocuments();
  await backend.saveProfile(profileDraft(timezone));
  return backend;
}

/** Wraps a backend and records the calls the sync makes. */
function spy(backend: SocialBackend) {
  const calls: { name: string; args: unknown[] }[] = [];
  const wrapped = new Proxy(backend, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || !['publishPracticeDays', 'publishMilestone', 'setUsesLinux'].includes(String(prop))) return value;
      return async (...args: unknown[]) => {
        calls.push({ name: String(prop), args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { wrapped, calls };
}

function manualSchedule() {
  const jobs: { fn: () => void; cancelled: boolean }[] = [];
  return {
    schedule: (fn: () => void) => {
      const job = { fn, cancelled: false };
      jobs.push(job);
      return { cancel: () => void (job.cancelled = true) };
    },
    runPending: () => jobs.filter((j) => !j.cancelled).splice(0).forEach((j) => j.fn()),
    live: () => jobs.filter((j) => !j.cancelled).length,
  };
}

function setup(backend: SocialBackend, store = new MemoryStudyStore(), sched = manualSchedule()) {
  const sync = createPracticeSync({
    store, backend, clock: { now: () => NOW }, timeZone: () => 'America/Sao_Paulo', platform: 'linux', statePath: null, schedule: sched.schedule,
  });
  return { sync, store, sched };
}

test('the first start uploads every active day, the second nothing', async () => {
  const { wrapped, calls } = spy(await member());
  const store = new MemoryStudyStore();
  answer(store, new Date('2026-10-12T13:00:00Z'));
  answer(store, new Date('2026-10-14T02:30:00Z')); // 13 Oct in São Paulo
  const { sync } = setup(wrapped, store);
  await sync.start();
  const days = calls.filter((c) => c.name === 'publishPracticeDays');
  expect(days).toHaveLength(1);
  expect(days[0]!.args[0]).toEqual([
    { day: '2026-10-12', answers: 1, reviews: 0 },
    { day: '2026-10-13', answers: 1, reviews: 0 },
  ]);
  expect(calls.find((c) => c.name === 'setUsesLinux')!.args).toEqual([true]);
  await sync.flush();
  expect(calls.filter((c) => c.name === 'publishPracticeDays')).toHaveLength(1);
});

test('twenty answers in a row produce one upload with only the changed day', async () => {
  const { wrapped, calls } = spy(await member());
  const { sync, store, sched } = setup(wrapped);
  answer(store, new Date('2026-10-10T13:00:00Z'));
  await sync.start();
  for (let i = 0; i < 20; i++) {
    answer(store, new Date(NOW.getTime() - i * 1000));
    sync.notify('answer');
  }
  expect(sched.live()).toBe(1);
  sched.runPending();
  await sync.flush();
  const days = calls.filter((c) => c.name === 'publishPracticeDays');
  expect(days).toHaveLength(2);
  expect(days[1]!.args[0]).toEqual([{ day: '2026-10-14', answers: 20, reviews: 0 }]);
});

test('offline: no error, nothing marked as sent, the next flush retries', async () => {
  const backend = await member();
  let failures = 1;
  const flaky = new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === 'publishPracticeDays') {
        return async (...args: unknown[]) => {
          if (failures-- > 0) throw new SocialError('offline', 'fetch failed');
          return target.publishPracticeDays(...(args as [never]));
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const { sync, store } = setup(flaky);
  answer(store, new Date('2026-10-14T13:00:00Z'));
  await expect(sync.start()).resolves.toBeUndefined();
  expect((await backend.practiceGraph((await backend.session())!.userId)).days).toEqual([]);
  await sync.flush();
  expect((await backend.practiceGraph((await backend.session())!.userId)).days).toEqual([{ day: '2026-10-14', answers: 1, reviews: 0 }]);
});

test('people who are not members are never synced', async () => {
  const { wrapped, calls } = spy(createFakeSocialBackend());
  const { sync, store } = setup(wrapped);
  answer(store, new Date('2026-10-14T13:00:00Z'));
  await sync.start();
  expect(calls).toEqual([]);
});

test('vocabulary and level milestones are sent once', async () => {
  const { wrapped, calls } = spy(await member());
  const { sync, store, sched } = setup(wrapped);
  answer(store, new Date('2026-10-14T13:00:00Z'), 50);
  await sync.start();
  sync.notify('level', 'B1>B2');
  sched.runPending();
  await sync.flush();
  await sync.flush();
  const milestones = calls.filter((c) => c.name === 'publishMilestone').map((c) => c.args);
  expect(milestones).toEqual([
    ['vocabulary', '50'],
    ['level_up', 'B1>B2'],
  ]);
});

test('the cache file survives a restart and belongs to one account', async () => {
  const backend = await member();
  const { wrapped, calls } = spy(backend);
  const store = new MemoryStudyStore();
  answer(store, new Date('2026-10-14T13:00:00Z'));
  const statePath = join(mkdtempSync(join(tmpdir(), 'devtalk-sync-')), 'practice-sync.json');
  const make = () =>
    createPracticeSync({ store, backend: wrapped, clock: { now: () => NOW }, timeZone: () => 'America/Sao_Paulo', platform: 'win32', statePath, schedule: manualSchedule().schedule });
  await make().start();
  await make().start();
  expect(calls.filter((c) => c.name === 'publishPracticeDays')).toHaveLength(1);
  expect(calls.filter((c) => c.name === 'setUsesLinux').map((c) => c.args)).toEqual([[false], [false]]);
  expect(readFileSync(statePath, 'utf8')).not.toContain('I fixed it');

  const other = JSON.parse(readFileSync(statePath, 'utf8')) as { userId: string };
  writeFileSync(statePath, JSON.stringify({ ...other, userId: 'someone-else' }));
  await make().start();
  expect(calls.filter((c) => c.name === 'publishPracticeDays')).toHaveLength(2);
});

test('days are counted in the profile\'s time zone, the one the streak uses', async () => {
  const { wrapped, calls } = spy(await member('Asia/Tokyo'));
  const { sync, store } = setup(wrapped); // the machine is in São Paulo
  answer(store, new Date('2026-10-14T15:30:00Z')); // 12:30 on the 14th in São Paulo, 00:30 on the 15th in Tokyo
  await sync.start();
  expect(calls.find((c) => c.name === 'publishPracticeDays')!.args[0]).toEqual([{ day: '2026-10-15', answers: 1, reviews: 0 }]);
});

test('after a time zone change, a day left without activity is sent as zero', async () => {
  const backend = await member('America/Sao_Paulo');
  const { wrapped, calls } = spy(backend);
  const { sync, store } = setup(wrapped);
  answer(store, new Date('2026-10-14T02:30:00Z')); // the 13th in São Paulo, the 14th in Tokyo
  await sync.start();
  await backend.saveProfile(profileDraft('Asia/Tokyo'));
  await sync.flush();
  const days = calls.filter((c) => c.name === 'publishPracticeDays').map((c) => c.args[0]);
  expect(days).toEqual([
    [{ day: '2026-10-13', answers: 1, reviews: 0 }],
    [{ day: '2026-10-13', answers: 0, reviews: 0 }, { day: '2026-10-14', answers: 1, reviews: 0 }],
  ]);
  await sync.flush();
  expect(calls.filter((c) => c.name === 'publishPracticeDays')).toHaveLength(2);
});

test('an invalid profile time zone falls back to the machine\'s', async () => {
  const backend = await member('Asia/Tokyo');
  const odd = new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === 'getOwnProfile') return async () => ({ ...(await target.getOwnProfile())!, timezone: 'Mars/Olympus' });
      return Reflect.get(target, prop, receiver);
    },
  });
  const { wrapped, calls } = spy(odd);
  const { sync, store } = setup(wrapped); // the machine is in São Paulo
  answer(store, new Date('2026-10-14T02:30:00Z')); // the 13th in São Paulo, the 14th in Tokyo
  await sync.start();
  expect(calls.find((c) => c.name === 'publishPracticeDays')!.args[0]).toEqual([{ day: '2026-10-13', answers: 1, reviews: 0 }]);
});
