import { LOCAL_DATA_FILE } from '../../src/main/local-data';

// "Delete my local data" removes exactly these files from the data folder; everything else stays.
test('the local data pattern covers the database, the keys, the community files and the daily challenge settings', () => {
  const files = [
    'devtalk.sqlite', 'devtalk.sqlite-wal', 'devtalk.sqlite-shm',
    'api-key.bin', 'api-key-gemini.bin', 'api-key-ollama.bin',
    'social-session.bin', 'fake-social.json', 'practice-sync.json',
    'daily.json',
  ];
  for (const name of files) expect(LOCAL_DATA_FILE.test(name), name).toBe(true);
});

test('it matches whole file names only', () => {
  const others = [
    'daily.json.bak', 'daily.jsonl', 'my-daily.json', 'daily.JSON', 'dailyXjson',
    'devtalk.sqlite.bak', 'Preferences', 'Local Storage', 'Cookies', 'Network', 'sessionData',
  ];
  for (const name of others) expect(LOCAL_DATA_FILE.test(name), name).toBe(false);
});
