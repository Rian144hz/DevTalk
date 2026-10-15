import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Badge } from '../../src/core/social/types';
import { BADGE_LABELS } from '../../src/core/social/badges';
import { MASCOTS } from '../../src/core/social/types';
import { BADGE_ICONS, badgeText, orderBadges } from '../../src/renderer/lib/badges';
import { MASCOT_NAMES, MASCOT_URLS } from '../../src/renderer/lib/mascots';

const b = (id: string, group: Badge['group'], label = id, detail: string | null = null): Badge => ({ id, group, label, detail });

test('every badge in the catalog has a drawn icon', () => {
  for (const id of Object.keys(BADGE_LABELS)) {
    expect(BADGE_ICONS[id], id).toBeDefined();
    expect(BADGE_ICONS[id]!.length).toBeGreaterThan(0);
    for (const d of BADGE_ICONS[id]!) expect(d).toMatch(/^M/);
  }
});

test('badges are ordered community, technical, language, evolution, keeping order inside a group', () => {
  const sorted = orderBadges([
    b('streak_7', 'evolution'), b('lang:python', 'language'), b('linux', 'technical'), b('mentor', 'community'),
    b('area:backend', 'technical'), b('creator', 'community'), b('lang:java', 'language'),
  ]);
  expect(sorted.map((x) => x.id)).toEqual(['mentor', 'creator', 'linux', 'area:backend', 'lang:python', 'lang:java', 'streak_7']);
});

test('language badges show the stack name people know; others their label', () => {
  expect(badgeText(b('lang:java', 'language', 'java'))).toBe('Java');
  expect(badgeText(b('lang:c++', 'language', 'c++'))).toBe('C++');
  expect(badgeText(b('lang:my-lib', 'language', 'my-lib'))).toBe('my-lib');
  expect(badgeText(b('level_up', 'evolution', 'B1 → B2', 'B1>B2'))).toBe('B1 → B2');
  expect(badgeText(b('mentor', 'community', 'Mentor'))).toBe('Mentor');
});

test('the nine mascots are bundled, each with a name', () => {
  expect(Object.keys(MASCOT_URLS).sort()).toEqual([...MASCOTS].sort());
  for (const id of MASCOTS) {
    expect(existsSync(join(__dirname, '../../src/renderer/assets/mascots', `${id}.webp`)), id).toBe(true);
    expect(MASCOT_NAMES[id]).toMatch(/\w/);
  }
});
