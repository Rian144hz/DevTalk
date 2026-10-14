import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export type DB = Database.Database;

export class DatabaseTooNewError extends Error {
  constructor(found: number, supported: number) {
    super(
      `This data was saved by a newer version of DevTalk (schema ${found}; this version supports ${supported}). ` +
        'Update the app to open it.',
    );
    this.name = 'DatabaseTooNewError';
  }
}

export function openDatabase(path: string): DB {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > MIGRATIONS.length) throw new DatabaseTooNewError(version, MIGRATIONS.length);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
