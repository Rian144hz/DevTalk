import { createSocialHandlers } from '../../src/main/ipc/social-handlers';
import { createFakeSocialBackend, type FakeSocialOptions } from '../../src/main/social/fake-backend';
import { runSocialSmoke } from '../../src/main/social/cli';

function setup(answers: (string | null)[], fake: FakeSocialOptions = {}) {
  const backend = createFakeSocialBackend(fake);
  const h = createSocialHandlers({
    backend,
    exportLocal: () => ({}),
    chooseSavePath: async () => null,
    writeFile: () => {},
    deleteLocalData: () => {},
    today: () => '2026-10-14',
  });
  const asked: string[] = [];
  const lines: string[] = [];
  const io = {
    ask: async (text: string) => {
      asked.push(text);
      return answers.shift() ?? null;
    },
    log: (line: string) => void lines.push(line),
  };
  return { h, io, asked, lines, backend };
}

test('signs in with e-mail and code, accepts the documents, creates the profile and reads it back', async () => {
  const { h, io, asked, lines, backend } = setup(['rian@example.com', '123456', 'Rian']);
  expect(await runSocialSmoke(h, io, { checkModerator: false })).toBe(0);
  expect(asked).toHaveLength(3);
  expect(lines.at(-1)).toBe('ok: signed in as rian@example.com, profile "Rian"');
  expect(await backend.hasAcceptedCurrentDocuments()).toBe(true);
});

test('a second run reuses the session and asks nothing', async () => {
  const { h, io, asked, lines } = setup(['rian@example.com', '123456', 'Rian']);
  await runSocialSmoke(h, io, { checkModerator: false });
  asked.length = 0;
  expect(await runSocialSmoke(h, io, { checkModerator: false })).toBe(0);
  expect(asked).toEqual([]);
  expect(lines.at(-1)).toBe('ok: signed in as rian@example.com, profile "Rian"');
});

test('a wrong code fails with its kind', async () => {
  const { h, io, lines } = setup(['rian@example.com', '000000']);
  expect(await runSocialSmoke(h, io, { checkModerator: false })).toBe(1);
  expect(lines.at(-1)).toMatch(/^failed at verify: \[invalid_code\]/);
});

test('closing a dialog stops the smoke', async () => {
  const { h, io, lines } = setup([null]);
  expect(await runSocialSmoke(h, io, { checkModerator: false })).toBe(1);
  expect(lines.at(-1)).toBe('cancelled');
});

test('--check-moderator reports the moderator flag', async () => {
  const { h, io, lines } = setup([], { seed: 'moderation' });
  expect(await runSocialSmoke(h, io, { checkModerator: true })).toBe(0);
  expect(lines).toContain('moderator: yes');
});
