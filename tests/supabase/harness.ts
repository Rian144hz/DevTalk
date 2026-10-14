import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(__dirname, '..', '..');
const STUBS = readFileSync(join(__dirname, 'stubs.sql'), 'utf8');

export function migrationFiles(): string[] {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

export interface TestDb {
  db: PGlite;
  /** Acts as a signed-in user (RLS applies), or as anon when `userId` is null. */
  as(userId: string | null): Promise<void>;
  /** Acts as the table owner (bypasses RLS), like the SQL Editor. */
  asOwner(): Promise<void>;
  /** Creates an auth user as the owner and returns its id; leaves the session as the owner. */
  newUser(email?: string): Promise<string>;
  /** Runs `sql` as the owner and comes back to the given user. */
  owner<T>(fn: () => Promise<T>): Promise<T>;
}

export async function createDb(): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(STUBS);
  for (const file of migrationFiles()) await db.exec(readFileSync(file, 'utf8'));
  let current: string | null | 'owner' = 'owner';

  const asOwner = async () => {
    await db.exec('reset role');
    current = 'owner';
  };
  const as = async (userId: string | null) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    await db.exec(userId ? 'set role authenticated' : 'set role anon');
    current = userId;
  };
  let n = 0;
  const newUser = async (email?: string) => {
    await asOwner();
    const r = await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [
      email ?? `user${++n}-${Date.now()}@example.com`,
    ]);
    return r.rows[0]!.id;
  };
  const owner = async <T>(fn: () => Promise<T>) => {
    const back = current;
    await asOwner();
    try {
      return await fn();
    } finally {
      if (back !== 'owner') await as(back);
    }
  };
  return { db, as, asOwner, newUser, owner };
}
