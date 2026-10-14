import { CHALLENGE_CATEGORIES, EXPRESSION_TYPE_LABELS, EXPRESSION_TYPES, MISTAKE_CATEGORIES, MISTAKE_LABELS } from '../../src/core/domain/categories';
import { countSentences, normalizeExpression, splitSentences } from '../../src/core/domain/text';

test('normalizeExpression lowercases, collapses spaces, trims edge punctuation', () => {
  expect(normalizeExpression('  Push Back   on ')).toBe('push back on');
  expect(normalizeExpression('"Root cause."')).toBe('root cause');
  expect(normalizeExpression("it's a trade-off!")).toBe("it's a trade-off");
});

test('countSentences', () => {
  expect(countSentences('')).toBe(0);
  expect(countSentences('   ')).toBe(0);
  expect(countSentences('I fixed it. Then I deployed! Done?')).toBe(3);
  expect(countSentences('We use e.g. Redis and v1.2 of the API.')).toBe(1);
  expect(countSentences('No final punctuation here')).toBe(1);
  expect(countSentences('Wait... what? Ok.')).toBe(3);
});

test('category lists are exactly the spec values', () => {
  expect(MISTAKE_CATEGORIES).toEqual([
    'articles', 'verb_tense', 'prepositions', 'word_order', 'word_choice', 'collocation',
    'subject_verb_agreement', 'plurals', 'missing_word', 'register', 'off_task',
  ]);
  expect(CHALLENGE_CATEGORIES).toEqual(['daily_update', 'code_review', 'bug_explanation', 'tech_interview']);
  expect(EXPRESSION_TYPES).toEqual(['chunk', 'phrasal_verb', 'collocation']);
});

test('splitSentences keeps abbreviations and versions inside a sentence and covers the text', () => {
  const t = 'We use e.g. Redis v1.2. It works!';
  const spans = splitSentences(t);
  expect(spans.map((s) => t.slice(s.start, s.end).trim())).toEqual(['We use e.g. Redis v1.2.', 'It works!']);
  expect(spans.map((s) => t.slice(s.start, s.end)).join('')).toBe(t);
  expect(splitSentences('   ')).toEqual([]);
  expect(splitSentences('no end')).toEqual([{ start: 0, end: 6 }]);
});

test('labels for categories and expression types', () => {
  expect(MISTAKE_LABELS.subject_verb_agreement).toBe('subject–verb agreement');
  expect(MISTAKE_LABELS.off_task).toBe('off topic');
  expect(MISTAKE_LABELS.verb_tense).toBe('verb tense');
  expect(EXPRESSION_TYPE_LABELS.phrasal_verb).toBe('phrasal verb');
});
