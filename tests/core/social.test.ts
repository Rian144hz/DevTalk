import { AREAS, LEGAL_DOCUMENTS, LEGAL_VERSION, REPORT_CONTEXTS, REPORT_REASONS } from '../../src/core/social/types';
import type { ProfileDraft } from '../../src/core/social/types';
import { ProfileDraftSchema, normalizeStackTags } from '../../src/core/social/validate';
import { MEMBER_PAGE_SIZE, MEMBER_QUERY_MAX, memberLine } from '../../src/core/social/people';

const valid: ProfileDraft = {
  displayName: 'Rian',
  nativeLanguage: 'Portuguese (Brazil)',
  level: 'B1',
  timezone: 'America/Bahia',
  area: 'backend',
  stack: ['python', 'java'],
  availability: [{ day: 1, from: '19:00', to: '21:00' }],
  bio: 'CS student. I like C++ and Linux.',
  mainStack: [],
  showProgress: true,
  mascot: null,
  listed: true,
};

function issuePaths(draft: unknown): string[] {
  const r = ProfileDraftSchema.safeParse(draft);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

test('fixed lists are exactly the spec values', () => {
  expect(AREAS).toEqual(['backend', 'frontend', 'mobile', 'data', 'devops', 'other']);
  expect(REPORT_REASONS).toEqual(['harassment', 'hate', 'sexual', 'spam', 'impersonation', 'minor', 'other']);
  expect(REPORT_CONTEXTS).toEqual(['profile', 'message', 'room']);
  expect(LEGAL_DOCUMENTS).toEqual(['terms', 'privacy', 'conduct']);
  expect(LEGAL_VERSION).toBe('2026-10-19');
});

test('normalizeStackTags trims, lowercases, collapses spaces, drops empties and duplicates', () => {
  expect(normalizeStackTags(['  Python', 'python ', 'React  Native', ''])).toEqual(['python', 'react native']);
});

test('normalizeStackTags keeps at most 10 tags', () => {
  const tags = Array.from({ length: 11 }, (_, i) => `lang${i}`);
  expect(normalizeStackTags(tags)).toEqual(tags.slice(0, 10));
});

test('a valid draft parses', () => {
  expect(ProfileDraftSchema.parse(valid)).toEqual(valid);
});

test('an empty bio and no stack or availability are fine', () => {
  expect(issuePaths({ ...valid, bio: '', stack: [], availability: [] })).toEqual([]);
});

test('display name must be 2 to 40 characters', () => {
  expect(issuePaths({ ...valid, displayName: 'x'.repeat(41) })).toEqual(['displayName']);
  expect(issuePaths({ ...valid, displayName: 'x' })).toEqual(['displayName']);
  expect(issuePaths({ ...valid, displayName: 'x'.repeat(40) })).toEqual([]);
});

test('stack allows at most 10 tags of at most 30 characters', () => {
  expect(issuePaths({ ...valid, stack: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toEqual(['stack']);
  expect(issuePaths({ ...valid, stack: ['x'.repeat(31)] })).toEqual(['stack.0']);
});

test('availability allows at most 14 slots', () => {
  const slots = Array.from({ length: 15 }, () => ({ day: 2, from: '08:00', to: '09:00' }));
  expect(issuePaths({ ...valid, availability: slots })).toEqual(['availability']);
  expect(issuePaths({ ...valid, availability: slots.slice(0, 14) })).toEqual([]);
});

test('a slot must start before it ends and use HH:MM', () => {
  expect(issuePaths({ ...valid, availability: [{ day: 1, from: '10:00', to: '09:00' }] })).toEqual(['availability.0']);
  expect(issuePaths({ ...valid, availability: [{ day: 1, from: '9:00', to: '10:00' }] })).toEqual(['availability.0.from']);
  expect(issuePaths({ ...valid, availability: [{ day: 7, from: '09:00', to: '10:00' }] })).toEqual(['availability.0.day']);
});

test('bio allows at most 160 characters', () => {
  expect(issuePaths({ ...valid, bio: 'x'.repeat(161) })).toEqual(['bio']);
});

test('level, area, language and timezone are checked', () => {
  expect(issuePaths({ ...valid, level: 'B3' })).toEqual(['level']);
  expect(issuePaths({ ...valid, area: 'qa' })).toEqual(['area']);
  expect(issuePaths({ ...valid, nativeLanguage: '' })).toEqual(['nativeLanguage']);
  expect(issuePaths({ ...valid, timezone: '' })).toEqual(['timezone']);
});

describe('people', () => {
  test('a draft must say whether the person is listed', () => {
    const { listed: _, ...withoutListed } = valid;
    expect(issuePaths(withoutListed)).toEqual(['listed']);
    expect(issuePaths({ ...valid, listed: false })).toEqual([]);
  });

  test('a member line names the area and the level', () => {
    const row = { id: 'u', displayName: 'Sam', level: 'B1' as const, area: 'backend' as const, mainStack: [], mascot: null, hasAvatar: false };
    expect(memberLine(row)).toBe('Back end developer, B1');
    expect(memberLine({ ...row, area: 'other', level: 'C1' })).toBe('Developer, C1');
    expect(memberLine({ ...row, area: 'devops' })).toBe('DevOps developer, B1');
  });

  test('page size and search length follow the spec', () => {
    expect(MEMBER_PAGE_SIZE).toBe(30);
    expect(MEMBER_QUERY_MAX).toBe(40);
  });
});
