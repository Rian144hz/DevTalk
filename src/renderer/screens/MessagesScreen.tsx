import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHAT_TEXT_MAX, chatText, type ConversationSummary } from '../../core/social/chat';
import type { SocialProfile } from '../../core/social/types';
import type { SocialStatus } from '../../shared/ipc-contract';
import { Avatar, Button, EmptyState, Notice, Skeleton } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { conversationTime, unreadTotal } from '../lib/chat';
import { useAppData } from '../app/AppData';
import type { Route } from '../lib/router';
import { useAvatars } from '../lib/useAvatars';
import { ConversationView } from './ConversationView';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
const go = (hash: string) => () => {
  window.location.hash = hash;
};

interface Loaded {
  status: SocialStatus;
  myId: string | null;
  conversations: ConversationSummary[];
}

function Head({ lede }: { lede?: string }) {
  return (
    <header className="page-head">
      <div>
        <h1>Messages</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
    </header>
  );
}

/** One row of the list: picture, name, last message (or what the request is waiting for), time and unread count. */
function ConversationRow({ c, avatar, current }: { c: ConversationSummary; avatar: string | null; current: boolean }) {
  const now = new Date();
  const meta =
    c.status === 'pending' && c.requestedByMe ? `Waiting for ${c.other.displayName}`
      : c.preview === null ? 'Message deleted'
      : c.preview;
  return (
    <a className="conversation-row" href={`#/messages/${c.id}`} aria-current={current ? 'page' : undefined}>
      <Avatar src={avatar} name={c.other.displayName} userId={c.other.id} mascot={c.other.mascot} size={40} />
      <span className="conversation-main">
        <span className="conversation-name">{c.other.displayName}</span>
        <span className={`conversation-meta${c.preview === null && !(c.status === 'pending' && c.requestedByMe) ? ' is-absent' : ''}`}>{meta}</span>
      </span>
      <span className="conversation-side">
        <span className="conversation-time">{conversationTime(c.lastMessageAt, now)}</span>
        {c.unread > 0 && <span className="count num">{c.unread}<span className="visually-hidden"> unread</span></span>}
      </span>
    </a>
  );
}

/** Requests waiting for your answer, then your conversations (and requests you sent), newest first. */
function ConversationList({ items, avatars, currentId }: { items: ConversationSummary[]; avatars: Record<string, string | null>; currentId: string | null }) {
  const incoming = items.filter((c) => c.status === 'pending' && !c.requestedByMe);
  const rest = items.filter((c) => !(c.status === 'pending' && !c.requestedByMe));
  const list = (rows: ConversationSummary[]) => (
    <ul className="conversation-list">
      {rows.map((c) => (
        <li key={c.id}><ConversationRow c={c} avatar={avatars[c.other.id] ?? null} current={c.id === currentId} /></li>
      ))}
    </ul>
  );
  return (
    <nav className="conversations" aria-label="Conversations">
      {incoming.length > 0 && (
        <section aria-label="Requests">
          <h2 className="conversations-title">Requests</h2>
          {list(incoming)}
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label="Conversations">
          {incoming.length > 0 && <h2 className="conversations-title">Conversations</h2>}
          {list(rest)}
        </section>
      )}
    </nav>
  );
}

/** The first message to someone you have no conversation with: it goes as a request. */
function NewConversation({ userId, onSent }: { userId: string; onSent(conversationId: string): void }) {
  const [profile, setProfile] = useState<SocialProfile | null | 'gone'>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = unwrap(await api().social.profileOf(userId));
        if (!alive) return;
        setProfile(p ?? 'gone');
        if (p?.hasAvatar) setAvatar(unwrap(await api().social.avatar(userId)));
      } catch (e) {
        if (alive) setError(message(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  if (profile === 'gone') {
    return (
      <section className="chat-pane chat-pane-empty">
        <EmptyState title="This member is not available." body="They may have left, been suspended, or blocked you." />
      </section>
    );
  }
  if (!profile) {
    return (
      <section className="chat-pane chat-pane-empty" aria-busy={!error}>
        {error ? <Notice tone="error" title={error} /> : <Skeleton width="40%" />}
      </section>
    );
  }
  const name = profile.displayName;
  const ready = chatText(text) !== null;
  async function send() {
    const body = chatText(text);
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSent(unwrap(await api().chat.request(userId, body)));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat-pane chat-new" aria-label={`New message to ${name}`}>
      <header className="chat-head">
        <Avatar src={avatar} name={name} userId={userId} mascot={profile.mascot} size={32} />
        <a className="chat-name" href={`#/people/u/${userId}`}>{name}</a>
      </header>
      <div className="chat-new-body">
        <h2>Message {name}</h2>
        <p className="lede">Your first message is a request. When {name} accepts it, you can talk and correct each other.</p>
        <label className="visually-hidden" htmlFor="chat-request">First message to {name}</label>
        <textarea id="chat-request" className="textarea chat-input" rows={4} value={text} maxLength={CHAT_TEXT_MAX * 2}
          placeholder={`Say hello and what you want to practise.`}
          onChange={(e) => setText(e.target.value)} />
        <div className="chat-compose-row">
          <span className={`chat-counter num${text.trim().length > CHAT_TEXT_MAX ? ' is-over' : ''}`}>{text.trim().length} / {CHAT_TEXT_MAX}</span>
          <Button variant="primary" busy={busy} disabled={!ready} onClick={() => void send()}>Send request</Button>
        </div>
        {error && <Notice tone="error" title={error} />}
      </div>
    </section>
  );
}

export function MessagesScreen({ route }: { route: Route }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const { setUnread } = useAppData();
  const people = useMemo(() => (data?.conversations ?? []).map((c) => ({ id: c.other.id, hasAvatar: c.other.hasAvatar })), [data]);
  const avatars = useAvatars(people);

  const load = useCallback(async () => {
    setError(null);
    try {
      const status = unwrap(await api().social.status());
      if (!status.signedIn || status.needsDocuments || !status.hasProfile) {
        setData({ status, myId: null, conversations: [] });
        return;
      }
      const [profile, conversations] = await Promise.all([
        api().social.getProfile().then(unwrap),
        api().chat.conversations().then(unwrap),
      ]);
      setData({ status, myId: profile?.id ?? null, conversations });
    } catch (e) {
      setError(message(e));
    }
  }, []);

  /** The list only (counts, previews, order), without the loading state. */
  const refreshList = useCallback(async () => {
    try {
      const conversations = unwrap(await api().chat.conversations());
      setData((d) => (d ? { ...d, conversations } : d));
      setUnread(unreadTotal(conversations));
    } catch {
      // Keep what is on screen; the next event or visit tries again.
    }
  }, [setUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      api().chat.onEvent((e) => {
        if (e.kind === 'offline') {
          setOffline(true);
          return;
        }
        if (e.kind === 'online') setOffline(false);
        void refreshList();
      }),
    [refreshList],
  );

  // #/messages/to/<id>: an existing conversation opens instead of a second request.
  const existing = route.to ? data?.conversations.find((c) => c.other.id === route.to) : undefined;
  useEffect(() => {
    if (existing) window.location.replace(`#/messages/${existing.id}`);
  }, [existing]);

  if (error) {
    return (
      <main className="page messages-page">
        <Head />
        <Notice tone="error" title={error} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page messages-page" aria-busy="true">
        <Head />
        <div className="profile-skeleton"><Skeleton width="30%" /><Skeleton width="60%" /><Skeleton width="45%" /></div>
      </main>
    );
  }
  const { status, myId, conversations } = data;
  if (!status.configured) {
    return (
      <main className="page messages-page">
        <Head />
        <EmptyState title="Community is not set up in this build" body="This copy of DevTalk has no community server. Your practice works as usual." />
      </main>
    );
  }
  if (!status.signedIn || status.needsDocuments || !status.hasProfile || !myId) {
    return (
      <main className="page messages-page">
        <Head />
        <EmptyState title="Join the community to send messages"
          body="Messages are private 1:1 conversations with other members, where you correct each other's English."
          action={<Button variant="primary" onClick={go('#/join')}>{status.signedIn ? 'Continue joining' : 'Join the community'}</Button>} />
      </main>
    );
  }

  const current = route.conversationId ? conversations.find((c) => c.id === route.conversationId) : undefined;
  const pane = route.to && !existing ? (
    <NewConversation key={route.to} userId={route.to} onSent={(id) => {
      void refreshList().then(() => {
        window.location.hash = `#/messages/${id}`;
      });
    }} />
  ) : current ? (
    <ConversationView key={current.id} summary={current} myId={myId} avatar={avatars[current.other.id] ?? null}
      onChanged={() => void refreshList()} />
  ) : route.conversationId ? (
    <section className="chat-pane chat-pane-empty">
      <EmptyState title="This conversation is not available." body="It may have been closed by a block, or the other member left." />
    </section>
  ) : (
    <section className="chat-pane chat-pane-empty">
      <p className="chat-hint">Choose a conversation.</p>
    </section>
  );

  return (
    <main className="page messages-page">
      <Head />
      {offline && <Notice tone="info" title="You are offline." detail="New messages will show when you are back online." />}
      {conversations.length === 0 && !route.to ? (
        <EmptyState title="No conversations yet."
          body="Open a member's profile and choose Send message. Your first message is a request they can accept."
          action={<Button variant="secondary" onClick={go('#/people')}>Go to Members</Button>} />
      ) : (
        <div className="messages">
          <ConversationList items={conversations} avatars={avatars} currentId={current?.id ?? null} />
          {pane}
        </div>
      )}
    </main>
  );
}
