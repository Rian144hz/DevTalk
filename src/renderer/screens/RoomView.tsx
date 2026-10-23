import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ROOM_TIMERS, cardFor, timerLeft, type RoomPerson, type RoomTimer } from '../../core/social/rooms';
import { Icon } from '../app/icons';
import { Button, Notice, ReportDialog, Skeleton } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import type { RoomSession } from '../lib/room-session';
import { namesList, OUTCOME_TEXT, roomMeta, seatsText } from '../lib/rooms';
import { RoomPeople, type PersonActions } from './RoomPeople';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
/** The arrival and departure line fades after this long. */
const ACTIVITY_MS = 10_000;

/** Runs an action; resolves to the error message, or null when it worked. */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return message(e);
  }
}

/** The time now, ticking while `everyMs` is set. */
function useNow(everyMs: number | null): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (everyMs === null) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * The room you are in: who is here (and speaking), the shared idea card and timer, and the bar with Mute/Unmute
 * (Ctrl+M), Leave and, for the host, End room. `onExit` takes you back to the list with a note, or none.
 */
export function RoomView({ session, myId, onExit }: { session: RoomSession; myId: string; onExit(note: string | null): void }) {
  const snap = useSyncExternalStore(session.subscribe, session.snapshot);
  const { state } = snap;
  const roomId = session.roomId;
  const cardId = useId();
  const timerId = useId();
  const [mutedForMe, setMutedForMe] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [reporting, setReporting] = useState<RoomPerson | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const now = useNow(state?.timer ? 250 : null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const endButton = useRef<HTMLButtonElement>(null);
  const wasEnding = useRef(false);

  // Cancelling (or Escape on) the End room question hands focus back to End room, not to the page.
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (wasEnding.current && !ending && lost) endButton.current?.focus();
    wasEnding.current = ending;
  }, [ending]);

  // Removed, the room ended, or the seat was lost: back to the list, saying why.
  useEffect(() => {
    if (snap.outcome) exit.current(OUTCOME_TEXT[snap.outcome]);
  }, [snap.outcome]);

  useEffect(() => {
    if (!snap.activity) return;
    setActivity(snap.activity.text);
    const timer = setTimeout(() => setActivity(null), ACTIVITY_MS);
    return () => clearTimeout(timer);
  }, [snap.activity]);

  // Ctrl+M mutes and unmutes, only while you are in a room.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'm') return;
      e.preventDefault();
      if (e.repeat) return;
      session.setMuted(!session.snapshot().muted);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const actions = useMemo<PersonActions>(() => {
    const rooms = () => api().rooms;
    return {
      mute: (p) => attempt(async () => unwrap(await rooms().mute(roomId, p.id))),
      remove: (p) =>
        attempt(async () => {
          session.noteRemoval(p.id, p.displayName);
          unwrap(await rooms().remove(roomId, p.id));
        }),
      makeModerator: (p) => attempt(async () => unwrap(await rooms().makeModerator(roomId, p.id))),
      removeModerator: (p) => attempt(async () => unwrap(await rooms().removeModerator(roomId, p.id))),
      makeHost: (p) => attempt(async () => unwrap(await rooms().passHost(roomId, p.id))),
      // Blocking someone in the room makes you leave it; they stay.
      block: async (p) => {
        const failure = await attempt(async () => unwrap(await api().safety.block(p.id)));
        if (!failure) exit.current(`You blocked ${p.displayName} and left the room.`);
        return failure;
      },
      report: (p) => setReporting(p),
    };
  }, [roomId, session]);

  async function run(kind: string, act: () => Promise<unknown>): Promise<boolean> {
    setBusy(kind);
    setError(null);
    const failure = await attempt(act);
    setBusy(null);
    if (failure) setError(failure);
    return failure === null;
  }

  const startTimer = (seconds: RoomTimer | null) => run(`timer-${seconds}`, async () => unwrap(await api().rooms.timer(roomId, seconds)));

  const isHost = state?.me.role === 'host';
  const readError = snap.readError && (
    <Notice tone="error" title={snap.readError} action={<Button variant="secondary" onClick={() => void session.refresh()}>Try again</Button>} />
  );
  // Mute/Unmute and Leave are always there, even while the room is loading or cannot be read: the microphone is live.
  const bar = (
    <footer className="room-bar" role="group" aria-label="Room controls">
      <Button variant="secondary" shortcut="Ctrl M" aria-label={snap.muted ? 'Unmute' : 'Mute'} aria-keyshortcuts="Control+M"
        onClick={() => session.setMuted(!snap.muted)}>
        <Icon name={snap.muted ? 'micOff' : 'rooms'} />
        {snap.muted ? 'Unmute' : 'Mute'}
      </Button>
      <Button variant="secondary" onClick={() => onExit(null)}>Leave</Button>
      {isHost && !ending && <Button ref={endButton} variant="quiet" onClick={() => setEnding(true)}>End room</Button>}
      {isHost && ending && (
        <div className="room-confirm" role="group" aria-label="End the room"
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || busy === 'end') return;
            e.stopPropagation();
            setEnding(false);
          }}>
          <p>End the room for everyone? The call stops for all.</p>
          <div className="row-actions">
            <Button variant="secondary" busy={busy === 'end'} autoFocus
              onClick={() => void run('end', async () => unwrap(await api().rooms.end(roomId))).then((done) => done && onExit('You ended the room.'))}>
              End room
            </Button>
            <Button variant="quiet" disabled={busy === 'end'} onClick={() => setEnding(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </footer>
  );

  if (!state) {
    return (
      <main className="page room-page" aria-busy={snap.readError ? undefined : 'true'}>
        <header className="page-head"><h1>Rooms</h1></header>
        {readError ? (
          <div className="room-notices">{readError}</div>
        ) : (
          <div className="profile-skeleton"><Skeleton width="40%" /><Skeleton width="60%" /><Skeleton width="50%" /></div>
        )}
        <div className="room" />
        {bar}
      </main>
    );
  }

  const host = state.people.find((p) => p.id === state.hostId);
  const left = timerLeft(state.timer, now);
  // One notice for everyone the call could not reach, in the order they sit in the room; people who left are not named.
  const unreachable = state.people.filter((p) => snap.unreachable.includes(p.id)).map((p) => p.displayName);

  return (
    <main className="page room-page">
      <header className="page-head">
        <div>
          <h1 dir="auto">{state.title}</h1>
          <p className="lede">
            {roomMeta(state)}, {seatsText(state.people.length)}
            {host && <>. Host: <bdi>{host.displayName}</bdi></>}
          </p>
        </div>
      </header>

      <div className="room-notices">
        {snap.offline && <Notice tone="info" title="Reconnecting…" detail="The connection to the community is down. The room comes back when it does." />}
        {snap.hostMuted && <Notice tone="info" title="The host muted you. You can unmute when you are ready." />}
        {unreachable.length > 0 && <Notice tone="error" title={`Could not connect to ${namesList(unreachable)}. Your network may block calls.`} />}
        {readError}
        {error && <Notice tone="error" title={error} />}
      </div>
      <p className="room-activity" role="status">{activity}</p>

      <div className="room">
        <RoomPeople people={state.people} myId={myId} myRole={state.me.role} peers={snap.peers} muted={snap.muted} micStream={session.stream}
          mutedForMe={mutedForMe} actions={actions}
          onMuteForMe={(id) => setMutedForMe((set) => {
            const next = new Set(set);
            if (!next.delete(id)) next.add(id);
            return next;
          })} />

        <div className="room-side">
          <section className="room-card" aria-labelledby={cardId}>
            <h2 id={cardId}>Idea card</h2>
            <p className="room-card-text">{cardFor(state.theme, state.card)}</p>
            <div className="row-actions">
              <Button variant="secondary" busy={busy === 'card'} onClick={() => void run('card', async () => unwrap(await api().rooms.nextCard(roomId)))}>
                Next card
              </Button>
            </div>
          </section>

          <section className="room-timer" aria-labelledby={timerId}>
            <h2 id={timerId}>Timer</h2>
            {left === null ? (
              <p className="room-timer-idle">A guide for everyone in the room. Start one when someone speaks.</p>
            ) : left > 0 ? (
              <p className="room-timer-left"><span className="room-timer-n num">{left}</span> s left</p>
            ) : (
              <p className="room-timer-left">Time is up.</p>
            )}
            <div className="row-actions">
              {ROOM_TIMERS.map((seconds) => (
                <Button key={seconds} variant="secondary" busy={busy === `timer-${seconds}`} aria-label={`Start a ${seconds} s timer`}
                  onClick={() => void startTimer(seconds)}>
                  {seconds} s
                </Button>
              ))}
              {left !== null && left > 0 && <Button variant="quiet" busy={busy === 'timer-null'} onClick={() => void startTimer(null)}>Stop</Button>}
            </div>
          </section>
        </div>
      </div>

      {bar}

      <ReportDialog open={reporting !== null} targetName={reporting?.displayName ?? ''} onClose={() => setReporting(null)}
        onSubmit={async ({ reason, details }) => {
          if (!reporting) return null;
          return attempt(async () => unwrap(await api().safety.report({ reported: reporting.id, contextType: 'room', contextId: roomId, reason, details })));
        }} />
    </main>
  );
}
