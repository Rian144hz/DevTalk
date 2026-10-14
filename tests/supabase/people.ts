import type { TestDb } from './harness';

const DOCS = ['terms', 'privacy', 'conduct', 'age_18'];

export async function accept(t: TestDb, uid: string): Promise<void> {
  await t.as(uid);
  for (const d of DOCS) await t.db.query(`insert into consents (user_id, document, version) values ($1, $2, '2026-10-14')`, [uid, d]);
}

export async function insertProfile(t: TestDb, uid: string, over: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: uid,
    display_name: 'Rian',
    native_language: 'Portuguese (Brazil)',
    level: 'B1',
    timezone: 'America/Bahia',
    area: 'backend',
    stack: ['python'],
    availability: JSON.stringify([{ day: 1, from: '19:00', to: '21:00' }]),
    bio: '',
    ...over,
  };
  const cols = Object.keys(row);
  await t.db.query(
    `insert into profiles (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

/** A signed-up user with consents and a profile; leaves the session as that user. */
export async function member(t: TestDb, over: Record<string, unknown> = {}): Promise<string> {
  const uid = await t.newUser();
  await accept(t, uid);
  await insertProfile(t, uid, over);
  return uid;
}

/** A member listed in `moderators`; leaves the session as that user. */
export async function moderator(t: TestDb): Promise<string> {
  const uid = await member(t, { display_name: 'Mod' });
  await t.owner(() => t.db.query('insert into moderators (user_id) values ($1)', [uid]));
  return uid;
}

export async function suspend(t: TestDb, uid: string, interval = '7 days'): Promise<void> {
  await t.owner(() => t.db.query(`update profiles set suspended_until = now() + $2::interval where id = $1`, [uid, interval]));
}

export async function visibleIds(t: TestDb): Promise<string[]> {
  return (await t.db.query<{ id: string }>('select id from profiles')).rows.map((r) => r.id);
}
