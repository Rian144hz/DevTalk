import { localDay } from '../../src/core/progress/practice';
import { MIDNIGHT_MARGIN_MS, msUntilLocalMidnight, watchDay, type DayWatchEnv } from '../../src/renderer/lib/day-watch';

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

describe('msUntilLocalMidnight', () => {
  test('is the time left in the local day, to the millisecond', () => {
    expect(msUntilLocalMidnight(at('2026-11-05T23:59:30.000Z'), 'UTC')).toBe(30_000);
    expect(msUntilLocalMidnight(at('2026-11-05T12:00:00.250Z'), 'UTC')).toBe(12 * HOUR - 250);
    // Exactly at midnight the new day has just begun: the next midnight is a whole day away, not zero.
    expect(msUntilLocalMidnight(at('2026-11-05T00:00:00.000Z'), 'UTC')).toBe(24 * HOUR);
    expect(msUntilLocalMidnight(at('2026-11-05T23:59:59.999Z'), 'UTC')).toBe(1);
    // A zone with no daylight saving, and a zone ahead of UTC: 02:30Z is 23:30 in São Paulo; 10:59:30Z is 23:59:30 in Auckland.
    expect(msUntilLocalMidnight(at('2026-11-05T02:30:00.000Z'), 'America/Sao_Paulo')).toBe(HOUR / 2);
    expect(msUntilLocalMidnight(at('2026-11-05T10:59:30.000Z'), 'Pacific/Auckland')).toBe(30_000);
  });

  test('in a zone that springs forward the day is 23 hours long (New York, 8 March 2026: 02:00 becomes 03:00)', () => {
    // 17:00 on the 7th: midnight is 7 hours away, as on any day.
    expect(msUntilLocalMidnight(at('2026-03-07T22:00:00.000Z'), 'America/New_York')).toBe(7 * HOUR);
    // 00:00 on the 8th: the next midnight is 23 hours away, not 24.
    expect(msUntilLocalMidnight(at('2026-03-08T05:00:00.000Z'), 'America/New_York')).toBe(23 * HOUR);
    // 01:30 EST, and 03:30 EDT an hour of the clock later: midnight is 21.5 and 20.5 hours away.
    expect(msUntilLocalMidnight(at('2026-03-08T06:30:00.000Z'), 'America/New_York')).toBe(21.5 * HOUR);
    expect(msUntilLocalMidnight(at('2026-03-08T07:30:00.000Z'), 'America/New_York')).toBe(20.5 * HOUR);
  });

  test('in a zone that falls back the day is 25 hours long (New York, 1 November 2026: 02:00 becomes 01:00)', () => {
    expect(msUntilLocalMidnight(at('2026-11-01T04:00:00.000Z'), 'America/New_York')).toBe(25 * HOUR);
    // 01:30 EDT, then 01:30 EST: the same wall time twice, an hour of the clock apart.
    expect(msUntilLocalMidnight(at('2026-11-01T05:30:00.000Z'), 'America/New_York')).toBe(23.5 * HOUR);
    expect(msUntilLocalMidnight(at('2026-11-01T06:30:00.000Z'), 'America/New_York')).toBe(22.5 * HOUR);
  });

  test('when the zone skips midnight itself, the new day begins at the change (Havana, 8 March 2026: 00:00 becomes 01:00)', () => {
    // 15:00 on the 7th: the 8th begins 9 hours later, at the moment the clock jumps to 01:00.
    const now = at('2026-03-07T20:00:00.000Z');
    const wait = msUntilLocalMidnight(now, 'America/Havana');
    expect(wait).toBe(9 * HOUR);
    expect(localDay(new Date(now.getTime() + wait - 1), 'America/Havana')).toBe('2026-03-07');
    expect(localDay(new Date(now.getTime() + wait), 'America/Havana')).toBe('2026-03-08');
  });

  test('half-hour changes and the longest days there are (Lord Howe 24.5 h, Troll 26 h)', () => {
    expect(msUntilLocalMidnight(at('2026-04-04T13:00:00.000Z'), 'Australia/Lord_Howe')).toBe(24.5 * HOUR);
    expect(msUntilLocalMidnight(at('2026-10-24T22:00:00.000Z'), 'Antarctica/Troll')).toBe(26 * HOUR);
  });

  test('by its own definition: the local day is the same one millisecond before the wait is over, and another when it is', () => {
    // Three days around each change of the zones below, sampled every 97 minutes (a step that is no round number of hours, so
    // the samples land at every wall time), plus a plain stretch in UTC.
    const windows: [string, string][] = [
      ['UTC', '2026-03-07T00:00:00Z'],
      ['America/New_York', '2026-03-07T00:00:00Z'],
      ['America/New_York', '2026-10-31T00:00:00Z'],
      ['America/Havana', '2026-03-07T00:00:00Z'],
      ['America/Havana', '2026-10-31T00:00:00Z'],
      ['Australia/Lord_Howe', '2026-04-04T00:00:00Z'],
      ['Pacific/Auckland', '2026-09-26T00:00:00Z'],
      ['Europe/Lisbon', '2026-03-28T00:00:00Z'],
      ['Antarctica/Troll', '2026-10-24T00:00:00Z'],
    ];
    let checked = 0;
    for (const [timeZone, from] of windows) {
      for (let t = Date.parse(from); t < Date.parse(from) + 72 * HOUR; t += 97 * 60_000) {
        const now = new Date(t);
        const wait = msUntilLocalMidnight(now, timeZone);
        expect(wait, `${timeZone} ${now.toISOString()}`).toBeGreaterThan(0);
        expect(wait, `${timeZone} ${now.toISOString()}`).toBeLessThanOrEqual(26 * HOUR);
        const today = localDay(now, timeZone);
        expect(localDay(new Date(t + wait - 1), timeZone), `${timeZone} ${now.toISOString()} (one millisecond before)`).toBe(today);
        expect(localDay(new Date(t + wait), timeZone), `${timeZone} ${now.toISOString()} (at the end)`).not.toBe(today);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(400);
  }, 30_000);

  test('without a zone it is this machine\'s zone', () => {
    const now = new Date();
    const wait = msUntilLocalMidnight(now);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(wait).toBe(msUntilLocalMidnight(now, zone));
    expect(wait).toBeGreaterThan(0);
  });
});

/** An event target that knows which listeners are on it, so a test can see that stopping lets go of every one. */
class Tracked extends EventTarget {
  readonly live = new Set<unknown>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    this.live.add(listener);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    this.live.delete(listener);
    super.removeEventListener(type, listener, options);
  }
}

/** A clock and timers the test moves by hand, and a window and a document it can send events to. */
function setup(startIso: string, timeZone = 'UTC') {
  let now = Date.parse(startIso);
  const timers = new Map<number, { fn: () => void; due: number }>();
  let nextId = 1;
  const win = new Tracked();
  const doc = Object.assign(new Tracked(), { visibilityState: 'visible' });
  const refresh = vi.fn();
  const env: DayWatchEnv = {
    refresh,
    now: () => new Date(now),
    win,
    doc,
    timeZone,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  const stop = watchDay(env);
  /** The clock goes to when the armed timer is due, and it fires. */
  const fireNext = () => {
    const [id, timer] = [...timers.entries()][0]!;
    now = timer.due;
    timers.delete(id);
    timer.fn();
  };
  const due = () => [...timers.values()].map((t) => new Date(t.due).toISOString());
  return { stop, refresh, timers, win, doc, fireNext, due, setNow: (iso: string) => { now = Date.parse(iso); } };
}

describe('watchDay', () => {
  test('arms one timer for a moment after the next local midnight, and reads nothing yet', () => {
    const w = setup('2026-11-05T23:59:30.000Z');
    expect(MIDNIGHT_MARGIN_MS).toBeGreaterThanOrEqual(500);
    expect(w.timers.size).toBe(1);
    expect(w.due()).toEqual([new Date(Date.parse('2026-11-05T23:59:30.000Z') + 30_000 + MIDNIGHT_MARGIN_MS).toISOString()]);
    expect(w.refresh).not.toHaveBeenCalled();
  });

  test('when it fires it reads again and arms the next one for the following midnight, again and again', () => {
    const w = setup('2026-11-05T23:59:30.000Z');
    w.fireNext();
    expect(w.refresh).toHaveBeenCalledTimes(1);
    // One timer at a time, a day after the first one was due (UTC has days of 24 hours).
    expect(w.timers.size).toBe(1);
    expect(w.due()).toEqual(['2026-11-07T00:00:01.000Z']);
    w.fireNext();
    w.fireNext();
    expect(w.refresh).toHaveBeenCalledTimes(3);
    expect(w.timers.size).toBe(1);
    expect(w.due()).toEqual(['2026-11-09T00:00:01.000Z']);
  });

  test('across a change of the clock the next timer follows the real midnight (New York, 23-hour and 25-hour days)', () => {
    const spring = setup('2026-03-07T22:00:00.000Z', 'America/New_York');
    spring.fireNext();
    // The 8th was 23 hours long: the next timer is for 00:00:01 EDT on the 9th, 23 hours after the first.
    expect(spring.due()).toEqual(['2026-03-09T04:00:01.000Z']);

    const fall = setup('2026-10-31T22:00:00.000Z', 'America/New_York');
    fall.fireNext();
    // 1 November was 25 hours long: 00:00:01 EST on the 2nd, 25 hours after 00:00:01 EDT on the 1st.
    expect(fall.due()).toEqual(['2026-11-02T05:00:01.000Z']);
  });

  test('the window getting the focus reads again and arms a fresh timer from the time it is then', () => {
    const w = setup('2026-11-05T20:00:00.000Z');
    expect(w.due()).toEqual(['2026-11-06T00:00:01.000Z']);
    // The computer slept; it wakes at 07:00 and the window is shown: the old timer is replaced, not left beside the new one.
    w.setNow('2026-11-06T07:00:00.000Z');
    w.win.dispatchEvent(new Event('focus'));
    expect(w.refresh).toHaveBeenCalledTimes(1);
    expect(w.timers.size).toBe(1);
    expect(w.due()).toEqual(['2026-11-07T00:00:01.000Z']);
    for (let i = 0; i < 5; i++) w.win.dispatchEvent(new Event('focus'));
    expect(w.refresh).toHaveBeenCalledTimes(6);
    expect(w.timers.size).toBe(1);
  });

  test('a document that becomes visible reads again; one that is hidden does not', () => {
    const w = setup('2026-11-05T20:00:00.000Z');
    w.doc.visibilityState = 'hidden';
    w.doc.dispatchEvent(new Event('visibilitychange'));
    expect(w.refresh).not.toHaveBeenCalled();
    w.setNow('2026-11-06T07:00:00.000Z');
    w.doc.visibilityState = 'visible';
    w.doc.dispatchEvent(new Event('visibilitychange'));
    expect(w.refresh).toHaveBeenCalledTimes(1);
    expect(w.due()).toEqual(['2026-11-07T00:00:01.000Z']);
  });

  test('stop clears the timer and lets go of the window and the document: nothing is read after it', () => {
    const w = setup('2026-11-05T20:00:00.000Z');
    // One listener on each while it watches (the focus of the window, the visibility of the document) and one timer.
    expect(w.win.live.size).toBe(1);
    expect(w.doc.live.size).toBe(1);
    expect(w.timers.size).toBe(1);
    w.stop();
    expect(w.win.live.size).toBe(0);
    expect(w.doc.live.size).toBe(0);
    expect(w.timers.size).toBe(0);
    w.win.dispatchEvent(new Event('focus'));
    w.doc.dispatchEvent(new Event('visibilitychange'));
    expect(w.refresh).not.toHaveBeenCalled();
    expect(w.timers.size).toBe(0);
    // Stopping again, or after a timer that was due, is fine.
    expect(() => w.stop()).not.toThrow();
  });

  test('a timer that was already due when stop was called does not read or arm another', () => {
    const w = setup('2026-11-05T23:59:30.000Z');
    const [timer] = [...w.timers.values()];
    w.stop();
    timer!.fn();
    expect(w.refresh).not.toHaveBeenCalled();
    expect(w.timers.size).toBe(0);
  });
});
