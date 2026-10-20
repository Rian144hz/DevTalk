import {
  ROOM_CARDS,
  ROOM_CONNECT_TIMEOUT_MS,
  ROOM_HEARTBEAT_MS,
  ROOM_MAX,
  ROOM_SIGNAL_MAX_BYTES,
  ROOM_THEMES,
  ROOM_THEME_LABELS,
  ROOM_TIMERS,
  ROOM_TITLE_MAX,
  ROOM_TITLE_MIN,
  cardFor,
  roomTitle,
  timerLeft,
} from '../../src/core/social/rooms';

test('room limits and choices', () => {
  expect(ROOM_MAX).toBe(6);
  expect(ROOM_TITLE_MIN).toBe(3);
  expect(ROOM_TITLE_MAX).toBe(60);
  expect(ROOM_HEARTBEAT_MS).toBe(30_000);
  expect(ROOM_CONNECT_TIMEOUT_MS).toBe(20_000);
  expect(ROOM_SIGNAL_MAX_BYTES).toBe(16_384);
  expect([...ROOM_THEMES]).toEqual(['standup', 'code_review', 'interview', 'free']);
  expect([...ROOM_TIMERS]).toEqual([60, 90]);
  expect(ROOM_THEME_LABELS).toEqual({
    standup: 'Stand-up',
    code_review: 'Code review',
    interview: 'Interview',
    free: 'Free talk',
  });
});

test('room title is trimmed and must be 3 to 60 characters', () => {
  expect(roomTitle('  Daily stand-up ')).toBe('Daily stand-up');
  expect(roomTitle('ab')).toBeNull();
  expect(roomTitle('  ab  ')).toBeNull();
  expect(roomTitle('   ')).toBeNull();
  expect(roomTitle('')).toBeNull();
  expect(roomTitle('abc')).toBe('abc');
  expect(roomTitle('x'.repeat(60))).toHaveLength(60);
  expect(roomTitle('x'.repeat(61))).toBeNull();
  expect(roomTitle(`  ${'x'.repeat(60)}  `)).toHaveLength(60);
});

test('room title keeps emoji and right-to-left text, counting characters like the database', () => {
  expect(roomTitle('Code review 🚀')).toBe('Code review 🚀');
  expect(roomTitle('مراجعة الكود')).toBe('مراجعة الكود');
  expect(roomTitle('🚀'.repeat(60))).toBe('🚀'.repeat(60));
  expect(roomTitle('🚀'.repeat(61))).toBeNull();
  expect(roomTitle('🚀🚀')).toBeNull();
});

test('cards: every theme has a label and at least 8 short prompts', () => {
  for (const theme of ROOM_THEMES) {
    expect(ROOM_THEME_LABELS[theme].length).toBeGreaterThan(0);
    expect(ROOM_CARDS[theme].length).toBeGreaterThanOrEqual(8);
    for (const card of ROOM_CARDS[theme]) {
      expect(card.trim()).toBe(card);
      expect(card.length).toBeGreaterThan(10);
      expect(card.length).toBeLessThanOrEqual(120);
    }
    expect(new Set(ROOM_CARDS[theme]).size).toBe(ROOM_CARDS[theme].length);
  }
});

test('cardFor picks by index and wraps around', () => {
  for (const theme of ROOM_THEMES) {
    const cards = ROOM_CARDS[theme];
    expect(cardFor(theme, 0)).toBe(cards[0]);
    expect(cardFor(theme, 3)).toBe(cards[3]);
    expect(cardFor(theme, cards.length)).toBe(cards[0]);
    expect(cardFor(theme, cards.length + 2)).toBe(cards[2]);
    expect(cardFor(theme, cards.length * 5 + 1)).toBe(cards[1]);
  }
});

test('timerLeft counts whole seconds down, rounded up, never below 0', () => {
  const startedAt = '2026-10-20T10:00:00.000Z';
  const start = new Date(startedAt).getTime();
  const at = (ms: number) => new Date(start + ms);
  const t60 = { startedAt, seconds: 60 as const };
  expect(timerLeft(t60, at(0))).toBe(60);
  expect(timerLeft(t60, at(1_000))).toBe(59);
  expect(timerLeft(t60, at(59_200))).toBe(1);
  expect(timerLeft(t60, at(59_999))).toBe(1);
  expect(timerLeft(t60, at(60_000))).toBe(0);
  expect(timerLeft(t60, at(61_000))).toBe(0);
  expect(timerLeft({ startedAt, seconds: 90 }, at(30_000))).toBe(60);
  expect(timerLeft({ startedAt, seconds: 90 }, at(0))).toBe(90);
  // A clock a little behind the server's never shows more than the full timer.
  expect(timerLeft(t60, at(-500))).toBe(60);
  expect(timerLeft(null, at(0))).toBeNull();
});
