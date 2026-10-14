import type { MistakeCategory } from '../../src/core/domain/categories';
import { buildGalley } from '../../src/core/feedback/galley';

const c = (original: string, corrected: string, category: MistakeCategory = 'word_choice', explanation = 'x') => ({
  original, corrected, category, explanation,
});
const rowText = (g: ReturnType<typeof buildGalley>) =>
  g.rows.map((r) => r.segments.map((s) => (s.kind === 'text' || s.kind === 'del' ? s.text : '')).join('')).join('');

test('marks an edit in place with its number and note', () => {
  const g = buildGalley('Yesterday I have worked on it. It works good.', [
    { original: 'have worked', corrected: 'worked', explanation: 'passado', category: 'verb_tense' },
    { original: 'good', corrected: 'well', explanation: 'advérbio', category: 'word_choice' },
  ]);
  expect(g.rows).toHaveLength(2);
  expect(g.rows[0]!.segments).toEqual([
    { kind: 'text', text: 'Yesterday I ' }, { kind: 'del', text: 'have worked' }, { kind: 'ins', text: 'worked' },
    { kind: 'mark', n: 1 }, { kind: 'text', text: ' on it. ' },
  ]);
  expect(g.rows[0]!.notes).toEqual([{ n: 1, category: 'verb_tense', explanation: 'passado' }]);
  expect(g.rows[1]!.notes).toEqual([{ n: 2, category: 'word_choice', explanation: 'advérbio' }]);
  expect(g.general).toEqual([]);
});

test('numbers follow the position in the text, not the order of the list', () => {
  const g = buildGalley('It works good. I have went home.', [c('have went', 'went'), c('good', 'well')]);
  expect(g.rows[0]!.notes[0]!.n).toBe(1);
  expect(g.rows[1]!.notes[0]!.n).toBe(2);
});

test('falls back to a case-insensitive match and keeps the learner’s casing in the deletion', () => {
  const g = buildGalley('Yesterday I go there.', [c('yesterday i go', 'Yesterday I went')]);
  expect(g.rows[0]!.segments[0]).toEqual({ kind: 'del', text: 'Yesterday I go' });
  expect(g.general).toEqual([]);
});

test('unlocatable, whole-answer, off-topic and overlapping edits become general notes', () => {
  const text = 'I think the cache is bad. It adds risk.';
  const g = buildGalley(text, [
    c('the cache is bad', 'the cache is risky'),
    c('cache is', 'cache was'),                       // overlaps the first
    c('something the learner never wrote', 'x'),       // not found
    c(text, 'Rewrite everything', 'off_task'),         // whole answer
    c('It adds risk.', 'Answer the challenge.', 'off_task'), // off topic is always general
  ]);
  expect(g.rows.flatMap((r) => r.notes).map((n) => n.n)).toEqual([1]);
  expect(g.general.map((n) => n.n)).toEqual([null, null, null, null]);
  expect(g.general).toHaveLength(4);
});

test('an edit crossing a sentence end merges those sentences into one row', () => {
  const g = buildGalley('It fails. Because the cache. Then ok.', [c('fails. Because', 'fails because')]);
  expect(g.rows).toHaveLength(2);
  expect(g.rows[0]!.notes).toHaveLength(1);
});

test('a pure deletion has no ins segment', () => {
  const g = buildGalley('We discuss about it.', [c(' about', '')]);
  expect(g.rows[0]!.segments.map((s) => s.kind)).toEqual(['text', 'del', 'mark', 'text']);
});

test('rows reproduce the original text', () => {
  const text = 'One. Two words here! Three?';
  expect(rowText(buildGalley(text, []))).toBe(text);
  expect(rowText(buildGalley(text, [c('words', 'word')]))).toBe(text);
});

test('empty originals are general notes', () => {
  expect(buildGalley('Hello there.', [c('', 'Hi')]).general).toHaveLength(1);
});
