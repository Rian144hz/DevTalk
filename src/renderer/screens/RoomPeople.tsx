import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RoomPerson, RoomRole } from '../../core/social/rooms';
import { Icon } from '../app/icons';
import { Avatar, BlockButton, Button } from '../design-system';
import { levelMeter } from '../lib/mic';
import type { PeerView } from '../lib/room-session';
import { roleLabel, roomActions, speakingNow } from '../lib/rooms';
import { useAvatars } from '../lib/useAvatars';

/** What the room view does for a person's options. Each resolves to an error message, or null when it worked. */
export interface PersonActions {
  mute(p: RoomPerson): Promise<string | null>;
  remove(p: RoomPerson): Promise<string | null>;
  makeModerator(p: RoomPerson): Promise<string | null>;
  removeModerator(p: RoomPerson): Promise<string | null>;
  makeHost(p: RoomPerson): Promise<string | null>;
  block(p: RoomPerson): Promise<string | null>;
  report(p: RoomPerson): void;
}

/** True while the stream's voice is loud enough to count as speaking. The meter reads levels only; nothing is kept. */
function useSpeaking(stream: MediaStream | null, listening: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream || !listening) return;
    let stop: (() => void) | null = null;
    try {
      stop = levelMeter(stream, (level) => setSpeaking((was) => speakingNow(level, was)));
    } catch {
      return;
    }
    return () => {
      stop?.();
      setSpeaking(false);
    };
  }, [stream, listening]);
  return speaking;
}

/**
 * Another person's voice: played by a hidden audio element (Chromium gives a meter silence from a remote stream that
 * is not playing), muted when you muted them for yourself.
 */
function useVoice(stream: MediaStream | null, mutedForMe: boolean) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<MediaStream | null>(null);
  useEffect(() => {
    const el = audio.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    setPlaying(stream);
    return () => {
      el.srcObject = null;
      setPlaying(null);
    };
  }, [stream]);
  useEffect(() => {
    if (audio.current) audio.current.muted = mutedForMe;
  }, [mutedForMe]);
  return { audio, speaking: useSpeaking(playing, playing !== null) };
}

function statusOf(peer: PeerView | undefined): string | null {
  if (!peer || peer.state === 'connecting') return 'Connecting…';
  return peer.state === 'failed' ? 'Could not connect' : null;
}

/** Brings a panel that just opened into view: the bar under the room is sticky and would cover its lower half. */
function useReveal() {
  return useCallback((el: HTMLElement | null) => el?.scrollIntoView?.({ block: 'nearest' }), []);
}

/** A person's options: for yourself (mute for me, report, block) and, by your role, for the room. */
function PersonOptions({ p, id, myRole, mutedForMe, onMuteForMe, actions, onDone }: {
  p: RoomPerson;
  id: string;
  myRole: RoomRole;
  mutedForMe: boolean;
  onMuteForMe(): void;
  actions: PersonActions;
  onDone(): void;
}) {
  const can = roomActions(myRole, p.role);
  const name = p.displayName;
  const [confirm, setConfirm] = useState<'remove' | 'host' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const reveal = useReveal();

  async function run(kind: string, act: () => Promise<string | null>, done?: string) {
    setBusy(kind);
    setError(null);
    const failure = await act();
    setBusy(null);
    if (failure) setError(failure);
    else if (done) setSaid(done);
    else onDone();
  }

  if (confirm) {
    const remove = confirm === 'remove';
    return (
      <div id={id} ref={reveal} className="room-confirm" role="group" aria-label={remove ? `Remove ${name}` : `Make ${name} the host`}>
        <p>{remove ? `Remove ${name} from this room? ${name} cannot come back to this room.` : `Make ${name} the host? You stop being the host.`}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="row-actions">
          <Button variant="secondary" busy={busy !== null} autoFocus
            onClick={() => void run(confirm, () => (remove ? actions.remove(p) : actions.makeHost(p)))}>
            {remove ? 'Remove' : 'Make host'}
          </Button>
          <Button variant="quiet" disabled={busy !== null} onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div id={id} ref={reveal} className="room-options" role="group" aria-label={`Options for ${name}`}>
      <div className="row-actions">
        <Button variant="quiet" onClick={onMuteForMe}>{mutedForMe ? 'Unmute for me' : 'Mute for me'}</Button>
        {can.mute && (
          <Button variant="secondary" busy={busy === 'mute'} onClick={() => void run('mute', () => actions.mute(p), `You muted ${name}. ${name} can unmute when ready.`)}>
            Mute
          </Button>
        )}
        {can.makeModerator && <Button variant="secondary" busy={busy === 'mod'} onClick={() => void run('mod', () => actions.makeModerator(p))}>Make moderator</Button>}
        {can.removeModerator && (
          <Button variant="secondary" busy={busy === 'mod'} onClick={() => void run('mod', () => actions.removeModerator(p))}>Remove moderator role</Button>
        )}
        {can.makeHost && <Button variant="secondary" onClick={() => setConfirm('host')}>Make host</Button>}
        {can.remove && <Button variant="secondary" onClick={() => setConfirm('remove')}>Remove</Button>}
        <Button variant="quiet" onClick={() => actions.report(p)}>Report</Button>
      </div>
      <BlockButton name={name} onBlock={() => actions.block(p)} />
      {said && <p className="room-said" role="status">{said}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function PersonRow({ p, me, peer, myRole, muted, micStream, avatar, mutedForMe, onMuteForMe, actions, open, onToggle }: {
  p: RoomPerson;
  me: boolean;
  peer: PeerView | undefined;
  myRole: RoomRole;
  muted: boolean;
  micStream: MediaStream;
  avatar: string | null;
  mutedForMe: boolean;
  onMuteForMe(): void;
  actions: PersonActions;
  open: boolean;
  onToggle(): void;
}) {
  const panelId = useId();
  const voice = useVoice(me ? null : (peer?.stream ?? null), mutedForMe);
  const mine = useSpeaking(me ? micStream : null, me && !muted);
  const speaking = me ? mine : voice.speaking;
  const role = roleLabel(p.role);
  // Your own state shows at once; the others' comes from the room (each person sets their own).
  const status = me
    ? (muted ? 'Muted' : null)
    : [p.muted ? 'Muted' : null, mutedForMe ? 'Muted for you' : null, statusOf(peer)].filter(Boolean).join(', ') || null;
  const quiet = me ? muted : p.muted || mutedForMe;
  return (
    <li className="room-person">
      <div className="room-person-row">
        <span className={`room-face${speaking ? ' is-speaking' : ''}`}>
          <Avatar src={avatar} name={p.displayName} userId={p.id} mascot={p.mascot} size={40} />
        </span>
        <span className="room-person-main">
          <span className="room-person-name"><bdi>{p.displayName}</bdi>{me && <span className="room-person-you"> (You)</span>}</span>
          <span className="room-person-meta">{[p.level, role, status].filter(Boolean).join(', ')}</span>
        </span>
        {speaking && <span className="visually-hidden">Speaking</span>}
        {quiet && <span className="room-person-muted"><Icon name="micOff" /></span>}
        {!me && (
          <Button variant="quiet" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={`Options for ${p.displayName}`} onClick={onToggle}>
            Options
          </Button>
        )}
        {!me && <audio ref={voice.audio} autoPlay />}
      </div>
      {open && (
        <PersonOptions p={p} id={panelId} myRole={myRole} mutedForMe={mutedForMe} onMuteForMe={onMuteForMe} actions={actions} onDone={onToggle} />
      )}
    </li>
  );
}

/** The people live in the room as ruled rows: face with the speaking ring, name, level, role and call status. */
export function RoomPeople({ people, myId, myRole, peers, muted, micStream, mutedForMe, onMuteForMe, actions }: {
  people: RoomPerson[];
  myId: string;
  myRole: RoomRole;
  peers: Readonly<Record<string, PeerView>>;
  muted: boolean;
  micStream: MediaStream;
  mutedForMe: ReadonlySet<string>;
  onMuteForMe(id: string): void;
  actions: PersonActions;
}) {
  const faces = useMemo(() => people.map((p) => ({ id: p.id, hasAvatar: p.hasAvatar })), [people]);
  const avatars = useAvatars(faces);
  const [open, setOpen] = useState<string | null>(null);
  const titleId = useId();
  return (
    <section className="room-people" aria-labelledby={titleId}>
      <h2 id={titleId}>People</h2>
      <ul className="room-person-list" aria-label="People in the room">
        {people.map((p) => (
          <PersonRow key={p.id} p={p} me={p.id === myId} peer={peers[p.id]} myRole={myRole} muted={muted} micStream={micStream}
            avatar={avatars[p.id] ?? null} mutedForMe={mutedForMe.has(p.id)} onMuteForMe={() => onMuteForMe(p.id)} actions={actions}
            open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))} />
        ))}
      </ul>
    </section>
  );
}
