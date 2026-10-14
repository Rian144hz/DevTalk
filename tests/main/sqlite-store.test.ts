import { openDatabase } from '../../src/main/db/open';
import { SqliteStudyStore } from '../../src/main/db/sqlite-store';
import { runStudyStoreContract } from '../contract/study-store.contract';

runStudyStoreContract('sqlite', () => new SqliteStudyStore(openDatabase(':memory:')));
