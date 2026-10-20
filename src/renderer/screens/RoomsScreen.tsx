import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { LEVELS, type Level } from '../../core/domain/types';
import {
  ROOM_MAX, ROOM_THEME_LABELS, ROOM_THEMES, ROOM_TITLE_MAX, ROOM_TITLE_MIN, roomTitle, type LiveRoom, type RoomDraft, type RoomTheme,
} from '../../core/social/rooms';
import type { SocialStatus } from '../../shared/ipc-contract';
import { Avatar, Button, EmptyState, Notice, Segmented, Select, Skeleton, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { latestOnly } from '../lib/latest';
import { levelMeter, openMic } from '../lib/mic';
import { browserPeer } from '../lib/room-call';
import { enterRoom, type RoomSession } from '../lib/room-session';
import { micProblem, roomMeta, seatsText } from '../lib/rooms';
import { parseHash } from '../lib/router';
import { useAvatars } from '../lib/useAvatars';
import { useRoute } from '../lib/useRoute';
import { RoomView } from './RoomView';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
/** The room list refreshes this often while it is on screen (there are no live events for it). */
const LIST_REFRESH_MS = 20_000;

type Target = { join: string } | { create: RoomDraft };
/** Enters a room with this microphone; `keep` hands the microphone over. Resolves to an error message, or null. */
type Enter = (target: Target, stream: MediaStream, keep: (stream: MediaStream) => void) => Promise<string | null>;

interface Ready {
  status: SocialStatus;
  myId: string | null;
}

function Head({ action }: { action?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>Rooms</h1>
        <p className="lede">Talk in English by voice, up to {ROOM_MAX} people. Your voice goes straight to the others and is never recorded.</p>
      </div>
      {action}
    </header>
  );
}

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

/**
 * The microphone for the check before entering: opened on mount (and on Try again), measured for the meter, stopped
 * on unmount unless it was kept for the room.
 */
function useMic() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [tries, setTries] = useState(0);
  const [level, setLevel] = useState(0);
  const kept = useRef<MediaStream | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: MediaStream | null = null;
    setProblem(null);
    openMic().then(
      (s) => {
        if (!alive) {
          stopStream(s);
          return;
        }
        opened = s;
        setStream(s);
      },
      (e: unknown) => {
        if (alive) setProblem(micProblem(e));
      },
    );
    return () => {
      alive = false;
      if (opened && kept.current !== opened) stopStream(opened);
      setStream(null);
    };
  }, [tries]);

  useEffect(() => {
    if (!stream) return;
    setLevel(0);
    try {
      return levelMeter(stream, setLevel);
    } catch {
      return undefined;
    }
  }, [stream]);

  return {
    stream,
    problem,
    level,
    retry: () => setTries((n) => n + 1),
    keep: (s: MediaStream) => {
      kept.current = s;
    },
  };
}

type Mic = ReturnType<typeof useMic>;

/** The level meter, or what is wrong with the microphone and how to fix it. */
function MicCheck({ mic }: { mic: Mic }) {
  const id = useId();
  if (mic.problem) {
    return <Notice tone="error" title={mic.problem.title} detail={mic.problem.detail} action={<Button variant="secondary" onClick={mic.retry}>Try again</Button>} />;
  }
  const percent = Math.round(mic.level * 100);
  return (
    <div className="mic-check">
      <span className="field-label" aria-hidden="true">Your microphone</span>
      <div className="mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent} aria-describedby={`${id}-hint`}>
        <span className="mic-meter-fill" style={{ transform: `scaleX(${mic.level})` }} />
      </div>
      <span className="field-hint" id={`${id}-hint`}>
        {mic.stream ? 'Say something. The bar moves when DevTalk hears you. Nothing is recorded.' : 'Asking for your microphone…'}
      </span>
    </div>
  );
}

/** Before joining: the room, the microphone check, Join room and Cancel. */
function JoinCheck({ room, onEnter, onCancel }: { room: LiveRoom; onEnter: Enter; onCancel(): void }) {
  const mic = useMic();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!mic.stream || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onEnter({ join: room.id }, mic.stream, mic.keep);
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <section className="room-sheet" aria-labelledby={titleId}>
      <h2 id={titleId}>Join <bdi>{room.title}</bdi></h2>
      <p className="lede">{roomMeta(room)}, {seatsText(room.people.length)}. Check your microphone first.</p>
      <MicCheck mic={mic} />
      {error && <Notice tone="error" title={error} />}
      <div className="row-actions">
        <Button variant="primary" busy={busy} disabled={!mic.stream} onClick={() => void join()}>Join room</Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </section>
  );
}

const THEME_OPTIONS = ROOM_THEMES.map((t) => ({ value: t, label: ROOM_THEME_LABELS[t] }));
const LEVEL_OPTIONS = [{ value: 'any', label: 'Any level' }, ...LEVELS.map((l) => ({ value: l, label: l }))];

/** A new room: title, theme and suggested level, with the microphone check; Create opens it and enters as its host. */
function CreateRoom({ onEnter, onCancel }: { onEnter: Enter; onCancel(): void }) {
  const mic = useMic();
  const titleId = useId();
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState<RoomTheme>('standup');
  const [level, setLevel] = useState<Level | 'any'>('any');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = roomTitle(title);

  async function create(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (clean === null || !mic.stream || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onEnter({ create: { title: clean, theme, level: level === 'any' ? null : level } }, mic.stream, mic.keep);
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <section className="room-sheet" aria-labelledby={titleId}>
      <h2 id={titleId}>Create a room</h2>
      <form className="room-form" onSubmit={(e) => void create(e)} noValidate>
        <TextField label="Title" value={title} maxLength={ROOM_TITLE_MAX * 4} autoFocus
          hint={`${ROOM_TITLE_MIN} to ${ROOM_TITLE_MAX} characters. Everyone sees it in the list.`}
          error={tried && clean === null ? `Write ${ROOM_TITLE_MIN} to ${ROOM_TITLE_MAX} characters.` : undefined}
          onChange={(e) => setTitle(e.target.value)} />
        <Segmented label="Theme" value={theme} options={THEME_OPTIONS} onChange={setTheme} />
        <Select label="Suggested level" value={level} options={LEVEL_OPTIONS} onChange={(e) => setLevel(e.target.value as Level | 'any')} />
        <MicCheck mic={mic} />
        {error && <Notice tone="error" title={error} />}
        <div className="row-actions">
          <Button variant="primary" type="submit" busy={busy} disabled={!mic.stream}>Create</Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}

/** Live rooms as ruled rows: title, theme and level, host, faces, seats, and Join or Full. */
function RoomList({ rooms }: { rooms: LiveRoom[] }) {
  const faces = useMemo(() => rooms.flatMap((r) => r.people.map((p) => ({ id: p.id, hasAvatar: p.hasAvatar }))), [rooms]);
  const avatars = useAvatars(faces);
  return (
    <ul className="room-list" aria-label="Live rooms">
      {rooms.map((r) => (
        <li key={r.id} className="room-row">
          <span className="room-row-main">
            <span className="room-row-title" dir="auto">{r.title}</span>
            <span className="room-row-meta">
              {roomMeta(r)}
              {r.hostName && <>. Host: <bdi>{r.hostName}</bdi></>}
            </span>
          </span>
          <span className="room-row-faces">
            {r.people.map((p) => (
              <Avatar key={p.id} src={avatars[p.id] ?? null} name={p.displayName} userId={p.id} mascot={p.mascot} size={24} />
            ))}
            <span className="visually-hidden">People: {r.people.map((p) => p.displayName).join(', ')}.</span>
          </span>
          <span className="room-row-seats num">{seatsText(r.people.length)}</span>
          {r.people.length >= ROOM_MAX ? (
            <span className="room-row-full">Full</span>
          ) : (
            <a className="btn btn-secondary" href={`#/rooms/${r.id}`} aria-label={`Join ${r.title}`}>Join</a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Rooms: the live list and Create a room on #/rooms; the microphone check, then the room itself, on #/rooms/<id>.
 * This screen owns the seat: leaving the room's route (another room, the list, another screen) leaves the room.
 */
export function RoomsScreen() {
  const [route] = useRoute();
  const [ready, setReady] = useState<Ready | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [latestList] = useState(latestOnly);
  const sessionRef = useRef<RoomSession | null>(null);
  const mounted = useRef(true);
  /** Each attempt to enter gets a number; leaving the screen or starting another makes the older one give up. */
  const attempt = useRef(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const status = unwrap(await api().social.status());
      if (!status.configured || !status.signedIn || status.needsDocuments || !status.hasProfile) {
        setReady({ status, myId: null });
        return;
      }
      const profile = unwrap(await api().social.getProfile());
      setReady({ status, myId: profile?.id ?? null });
    } catch (e) {
      setLoadError(message(e));
    }
  }, []);

  const loadList = useCallback(
    () =>
      latestList(api().rooms.list(), (r) => {
        if (r.ok) {
          setRooms(r.data);
          setListError(null);
        } else {
          setListError(r.error.message);
        }
      }),
    [latestList],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const myId = ready?.myId ?? null;
  const listing = myId !== null && session === null;
  useEffect(() => {
    if (!listing) return;
    void loadList();
    const timer = setInterval(() => void loadList(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [listing, loadList, route.roomId]);

  /** Out of the room: the seat goes, the list comes back (only when the room's page is still the one shown). */
  const exit = useCallback((note: string | null) => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    void s.leave();
    setSession(null);
    setFlash(note);
    if (parseHash(window.location.hash).roomId === s.roomId) window.location.replace('#/rooms');
  }, []);

  // Leaving the room's route leaves the room. The hash is read here, not from the render, so a room just entered
  // (its hash set a moment ago) is never taken for one being left.
  useEffect(() => {
    const s = sessionRef.current;
    if (s && parseHash(window.location.hash).roomId !== s.roomId) exit(null);
  }, [route.roomId, session, exit]);

  // Closing the screen leaves the room and gives up any entry still on its way.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current++;
      const s = sessionRef.current;
      sessionRef.current = null;
      void s?.leave();
    };
  }, []);

  const enter: Enter = useCallback(
    async (target, stream, keep) => {
      if (!myId) return null;
      const mine = ++attempt.current;
      try {
        const s = await enterRoom({ rooms: api().rooms, myId, stream, createPeer: browserPeer, target });
        const wanted = 'join' in target ? parseHash(window.location.hash).roomId === s.roomId : !parseHash(window.location.hash).roomId;
        if (mine !== attempt.current || !mounted.current || !wanted) {
          void s.leave();
          return null;
        }
        keep(stream);
        sessionRef.current = s;
        // The hash first: when React renders, the route already shows this room.
        if (parseHash(window.location.hash).roomId !== s.roomId) window.location.hash = `#/rooms/${s.roomId}`;
        setSession(s);
        setCreating(false);
        setFlash(null);
        return null;
      } catch (e) {
        return message(e);
      }
    },
    [myId],
  );

  if (loadError) {
    return (
      <main className="page rooms-page">
        <Head />
        <Notice tone="error" title={loadError} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="page rooms-page" aria-busy="true">
        <Head />
        <div className="profile-skeleton"><Skeleton width="30%" /><Skeleton width="60%" /><Skeleton width="45%" /></div>
      </main>
    );
  }
  const { status } = ready;
  if (!status.configured) {
    return (
      <main className="page rooms-page">
        <Head />
        <EmptyState title="Community is not set up in this build" body="This copy of DevTalk has no community server. Your practice works as usual." />
      </main>
    );
  }
  if (!myId) {
    return (
      <main className="page rooms-page">
        <Head />
        <EmptyState title="Join the community to talk in rooms"
          body="Rooms are live voice conversations in English with up to 6 members. Your voice is never recorded."
          action={<Button variant="primary" onClick={() => { window.location.hash = '#/join'; }}>{status.signedIn ? 'Continue joining' : 'Join the community'}</Button>} />
      </main>
    );
  }

  if (session && route.roomId === session.roomId) {
    return <RoomView key={session.roomId} session={session} myId={myId} onExit={exit} />;
  }

  if (route.roomId) {
    const room = rooms?.find((r) => r.id === route.roomId);
    return (
      <main className="page rooms-page">
        <Head />
        {room ? (
          <JoinCheck key={room.id} room={room} onEnter={enter} onCancel={() => window.location.replace('#/rooms')} />
        ) : rooms === null && !listError ? (
          <div className="profile-skeleton" aria-busy="true"><Skeleton width="40%" /><Skeleton width="60%" /></div>
        ) : (
          <EmptyState title="This room is not open." body="It may have ended, or it is full. Choose another room or create one."
            action={<Button variant="secondary" onClick={() => window.location.replace('#/rooms')}>Back to Rooms</Button>} />
        )}
      </main>
    );
  }

  return (
    <main className="page rooms-page">
      <Head action={!creating && <Button variant="primary" onClick={() => setCreating(true)}>Create a room</Button>} />
      {flash && <Notice tone="info" title={flash} />}
      {creating && <CreateRoom onEnter={enter} onCancel={() => setCreating(false)} />}
      {listError && <Notice tone="error" title={listError} action={<Button variant="secondary" onClick={() => void loadList()}>Try again</Button>} />}
      {rooms === null ? (
        !listError && <div className="profile-skeleton" aria-busy="true"><Skeleton width="50%" /><Skeleton width="70%" /></div>
      ) : rooms.length === 0 ? (
        <EmptyState title="No rooms right now." body="Create one and others can join." />
      ) : (
        <RoomList rooms={rooms} />
      )}
    </main>
  );
}
