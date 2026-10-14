import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import { runStudyStoreContract } from '../contract/study-store.contract';

runStudyStoreContract('memory', () => new MemoryStudyStore());
