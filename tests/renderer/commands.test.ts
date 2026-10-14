import { filterCommands, type Command } from '../../src/renderer/lib/commands';

const cmd = (label: string, keywords: string[] = []): Command => ({ id: label, label, keywords, run: () => {} });
const all = [
  cmd('Go to Today', ['home']), cmd('Go to Practice'), cmd('Go to Review'), cmd('Go to Progress'), cmd('Go to Settings', ['preferences', 'key']),
  cmd('Go to Rooms'), cmd('Get a new challenge'), cmd('Start review'), cmd('Switch to dark theme'),
];

test('empty query lists everything in declared order', () => {
  expect(filterCommands(all, '').map((c) => c.label)).toEqual(all.map((c) => c.label));
});

test('word-prefix matches come before loose matches, keeping declared order', () => {
  expect(filterCommands(all, 'rev').map((c) => c.label)).toEqual(['Go to Review', 'Start review']);
  expect(filterCommands(all, 'SET')[0]!.label).toBe('Go to Settings');
});

test('keywords match too', () => {
  expect(filterCommands(all, 'home').map((c) => c.label)).toEqual(['Go to Today']);
  expect(filterCommands(all, 'key').map((c) => c.label)).toEqual(['Go to Settings']);
});

test('subsequence matches are last; no match gives nothing', () => {
  expect(filterCommands(all, 'gtp').map((c) => c.label)).toEqual(['Go to Practice', 'Go to Progress']);
  expect(filterCommands(all, 'xyz')).toEqual([]);
});
