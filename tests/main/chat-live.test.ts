import type { ChatEvent } from '../../src/core/social/chat';
import type { SocialBackend } from '../../src/main/social/backend';
import { createChatLive, type ChatLiveEvent } from '../../src/main/social/chat-live';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';

async function people() {
  const backend = createFakeSocialBackend({ seed: 'people' });
  const ids = Object.fromEntries((await backend.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
  const withBia = (await backend.conversations()).find((c) => c.other.displayName === 'Bia')!;
  const events: ChatLiveEvent[] = [];
  const live = createChatLive({ backend, emit: (e) => events.push(e) });
  return { backend, ids, withBia, events, live };
}

test('forwards events of conversations the member can read', async () => {
  const { backend, ids, withBia, events, live } = await people();
  await live.start();
  backend.sendAsForTest(ids['Bia']!, withBia.id, 'hello');
  expect(events).toEqual([{ kind: 'online' }, { kind: 'message', conversationId: withBia.id }]);
});

test('nothing after sign-out; a new sign-in subscribes again', async () => {
  const { backend, ids, withBia, events, live } = await people();
  await live.start();
  await backend.signOut();
  await live.start();
  backend.sendAsForTest(ids['Bia']!, withBia.id, 'are you there?');
  expect(events.filter((e) => e.kind === 'message')).toEqual([]);
  await backend.verifyCode('rian@example.com', '123456');
  await live.start();
  backend.sendAsForTest(ids['Bia']!, withBia.id, 'back?');
  expect(events.filter((e) => e.kind === 'message')).toHaveLength(1);
});

test('a dropped connection says offline, then online when it comes back, once each', async () => {
  let status!: (online: boolean) => void;
  let onEvent!: (e: ChatEvent) => void;
  let stopped = 0;
  const backend = {
    configured: true,
    session: async () => ({ userId: 'u1', email: 'a@b.co' }),
    hasAcceptedCurrentDocuments: async () => true,
    subscribe: (e: (x: ChatEvent) => void, s: (on: boolean) => void) => {
      onEvent = e;
      status = s;
      return () => void stopped++;
    },
  } as unknown as SocialBackend;
  const events: ChatLiveEvent[] = [];
  const live = createChatLive({ backend, emit: (e) => events.push(e) });
  await live.start();
  status(true);
  status(false);
  status(false);
  status(true);
  onEvent({ kind: 'correction', conversationId: 'c1' });
  expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }, { kind: 'correction', conversationId: 'c1' }]);
  live.stop();
  expect(stopped).toBe(1);
  onEvent({ kind: 'message', conversationId: 'c1' });
  status(false);
  expect(events).toHaveLength(4);
});

test('never throws: offline at start, no documents, or no backend', async () => {
  const events: ChatLiveEvent[] = [];
  const offline = { configured: true, session: async () => { throw new Error('offline'); } } as unknown as SocialBackend;
  await expect(createChatLive({ backend: offline, emit: (e) => events.push(e) }).start()).resolves.toBeUndefined();
  let subscribed = 0;
  const noDocs = {
    configured: true,
    session: async () => ({ userId: 'u1', email: 'a@b.co' }),
    hasAcceptedCurrentDocuments: async () => false,
    subscribe: () => { subscribed++; return () => {}; },
  } as unknown as SocialBackend;
  await createChatLive({ backend: noDocs, emit: (e) => events.push(e) }).start();
  expect(subscribed).toBe(0);
  expect(events).toEqual([]);
});
