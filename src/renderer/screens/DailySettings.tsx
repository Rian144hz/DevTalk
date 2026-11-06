import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_REMINDER_TIME, REMINDER_TIME } from '../../core/daily/daily';
import type { DailySettings as Settings } from '../../shared/ipc-contract';
import { AppErrorException, api, unwrap } from '../lib/api';
import { Button, Notice, Skeleton, TextField } from '../design-system';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/**
 * Settings › Daily challenge: the switch and the reminder time. A change is saved as soon as it is made (the time once it is a
 * whole, valid time); what is shown goes back to what is saved if a save fails.
 */
export function DailySettings() {
  const switchId = useId();
  const hintId = useId();
  const [loaded, setLoaded] = useState<'loading' | 'error' | 'ready'>('loading');
  const [enabled, setEnabled] = useState(false);
  /** What the time field shows. A half-typed time reads as empty and is never saved. */
  const [time, setTime] = useState(DEFAULT_REMINDER_TIME);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState('');
  /** The last values main confirmed: where the field goes back to when a save fails or the time is left unfinished. */
  const confirmed = useRef<Settings>({ enabled: false, time: DEFAULT_REMINDER_TIME });

  const load = useCallback(() => {
    setLoaded('loading');
    api().daily.settings().then(
      (r) => {
        if (!r.ok) return setLoaded('error');
        confirmed.current = r.data;
        setEnabled(r.data.enabled);
        setTime(r.data.time);
        setLoaded('ready');
      },
      () => setLoaded('error'),
    );
  }, []);
  useEffect(load, [load]);

  async function save(patch: { enabled?: boolean; time?: string }) {
    setProblem(null);
    setNote('');
    try {
      confirmed.current = unwrap(await api().daily.setSettings(patch));
      setNote('Saved.');
    } catch (e) {
      setProblem(message(e));
      setEnabled(confirmed.current.enabled);
      setTime(confirmed.current.time);
    }
  }

  return (
    <section aria-labelledby="set-daily">
      <h2 id="set-daily">Daily challenge</h2>
      {loaded === 'loading' && <div aria-busy="true"><Skeleton width="40%" /><Skeleton width="25%" /></div>}
      {loaded === 'error' && (
        <Notice tone="error" title="Could not load these settings." action={<Button variant="secondary" onClick={load}>Try again</Button>} />
      )}
      {loaded === 'ready' && (
        <>
          <div className="field">
            <label className="check-row" htmlFor={switchId}>
              <input id={switchId} type="checkbox" checked={enabled} aria-describedby={hintId}
                onChange={(e) => { setEnabled(e.target.checked); void save({ enabled: e.target.checked }); }} />
              <span>Daily challenge</span>
            </label>
            <span className="field-hint" id={hintId}>One challenge a day, and a reminder at the time you choose.</span>
          </div>
          <div className="daily-time">
            <TextField label="Reminder time" type="time" value={time}
              onChange={(e) => {
                setTime(e.target.value);
                if (REMINDER_TIME.test(e.target.value) && e.target.value !== confirmed.current.time) void save({ time: e.target.value });
              }}
              onBlur={() => { if (!REMINDER_TIME.test(time)) setTime(confirmed.current.time); }} />
            {/* Always there, so the screen reader hears "Saved." when it appears. */}
            <span className="muted small daily-saved" role="status">{note}</span>
          </div>
          {problem && <Notice tone="error" title={problem} />}
        </>
      )}
    </section>
  );
}
