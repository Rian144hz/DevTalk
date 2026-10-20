import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAT_PAGE, CHAT_TEXT_MAX, chatText, type ChatMessage, type ConversationSummary } from '../../core/social/chat';
import { Avatar, Button, Notice } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { groupByDay, mergeMessages, messageTime } from '../lib/chat';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/** One message: plain text with its newlines, yours on the right. */
function MessageItem({ m, mine }: { m: ChatMessage; mine: boolean }) {
  return (
    <li className={`chat-message${mine ? ' is-mine' : ''}`}>
      {m.deleted ? (
        <p className="chat-bubble is-deleted">Message deleted</p>
      ) : (
        <p className="chat-bubble">{m.body}</p>
      )}
      <time className="chat-time" dateTime={m.createdAt}>{messageTime(m.createdAt)}</time>
    </li>
  );
}

/** Enter sends, Shift+Enter starts a new line; the counter turns amber past the limit. */
function Composer({ name, onSend }: { name: string; onSend(body: string): Promise<string | null> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = text.trim().length;
  const ready = chatText(text) !== null;

  async function send() {
    const body = chatText(text);
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const failed = await onSend(body);
    setBusy(false);
    if (failed) setError(failed);
    else setText('');
  }

  return (
    <div className="chat-compose">
      <label className="visually-hidden" htmlFor="chat-input">Message to {name}</label>
      <textarea id="chat-input" className="textarea chat-input" rows={2} value={text} maxLength={CHAT_TEXT_MAX * 2}
        placeholder={`Write to ${name}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }} />
      <div className="chat-compose-row">
        <span className={`chat-counter num${length > CHAT_TEXT_MAX ? ' is-over' : ''}`} aria-live="polite">
          {length} / {CHAT_TEXT_MAX}
        </span>
        <Button variant="primary" busy={busy} disabled={!ready} onClick={() => void send()}>Send</Button>
      </div>
      {error && <Notice tone="error" title={error} />}
    </div>
  );
}

/** One conversation: messages by day, a request to answer or wait for, and the composer. */
export function ConversationView({ summary, myId, avatar, onChanged }: {
  summary: ConversationSummary;
  myId: string;
  avatar: string | null;
  /** Something changed that the list shows (read, answered, sent). */
  onChanged(): void;
}) {
  const { id, other } = summary;
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const loaded = useRef(false);
  // The parent passes a new function each render; keep the latest without reloading on every render.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  /** The newest page, merged into what is shown; then the conversation counts as read. */
  const refresh = useCallback(async () => {
    try {
      const latest = unwrap(await api().chat.messages(id, null));
      if (!loaded.current) {
        loaded.current = true;
        setHasEarlier(latest.length === CHAT_PAGE);
      }
      setMessages((current) => mergeMessages(current ?? [], latest));
      setError(null);
      await api().chat.read(id);
      changed.current();
    } catch (e) {
      setError(message(e));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      api().chat.onEvent((e) => {
        if (e.kind === 'online' || ('conversationId' in e && e.conversationId === id)) void refresh();
      }),
    [id, refresh],
  );

  async function loadEarlier() {
    const oldest = messages?.[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    stickToBottom.current = false;
    try {
      const page = unwrap(await api().chat.messages(id, oldest.id));
      setHasEarlier(page.length === CHAT_PAGE);
      setMessages((current) => mergeMessages(current ?? [], page));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoadingEarlier(false);
    }
  }

  // New messages keep the view at the bottom unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function answer(accept: boolean) {
    setAnswering(true);
    setError(null);
    try {
      unwrap(await api().chat.respond(id, accept));
      changed.current();
      if (!accept) window.location.hash = '#/messages';
    } catch (e) {
      setError(message(e));
    } finally {
      setAnswering(false);
    }
  }

  async function send(body: string): Promise<string | null> {
    try {
      unwrap(await api().chat.send(id, body));
      stickToBottom.current = true;
      await refresh();
      return null;
    } catch (e) {
      return message(e);
    }
  }

  const groups = useMemo(() => groupByDay(messages ?? [], new Date()), [messages]);
  const incoming = summary.status === 'pending' && !summary.requestedByMe;
  const waiting = summary.status === 'pending' && summary.requestedByMe;

  return (
    <section className="chat-pane" aria-label={`Conversation with ${other.displayName}`}>
      <header className="chat-head">
        <Avatar src={avatar} name={other.displayName} userId={other.id} mascot={other.mascot} size={32} />
        <a className="chat-name" href={`#/people/u/${other.id}`}>{other.displayName}</a>
      </header>
      <div className="chat-scroll" ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}>
        {hasEarlier && (
          <div className="chat-earlier">
            <Button variant="secondary" busy={loadingEarlier} onClick={() => void loadEarlier()}>Load earlier</Button>
          </div>
        )}
        {messages === null && !error && <p className="chat-hint" aria-busy="true">Loading messages…</p>}
        {groups.map((g) => (
          <section key={g.key} className="chat-day" aria-label={g.label}>
            <h3 className="chat-day-label">{g.label}</h3>
            <ol className="chat-messages">
              {g.messages.map((m) => <MessageItem key={m.id} m={m} mine={m.senderId === myId} />)}
            </ol>
          </section>
        ))}
      </div>
      {error && <Notice tone="error" title={error} action={<Button variant="secondary" onClick={() => void refresh()}>Try again</Button>} />}
      {incoming ? (
        <div className="chat-request">
          <p><strong>{other.displayName} wants to practise with you.</strong> Accept to reply. If you decline, {other.displayName} is not told.</p>
          <div className="row-actions">
            <Button variant="primary" busy={answering} onClick={() => void answer(true)}>Accept</Button>
            <Button variant="secondary" disabled={answering} onClick={() => void answer(false)}>Decline</Button>
          </div>
        </div>
      ) : waiting ? (
        <p className="chat-waiting">Waiting for {other.displayName}. You can write more when they accept.</p>
      ) : (
        <Composer name={other.displayName} onSend={send} />
      )}
    </section>
  );
}
