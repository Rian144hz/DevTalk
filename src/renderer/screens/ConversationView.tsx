import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAT_PAGE, CHAT_TEXT_MAX, chatText, type ChatCheck, type ChatMessage, type ConversationSummary } from '../../core/social/chat';
import { applyCorrections } from '../../core/social/diff';
import { Avatar, Button, Notice, ReportDialog } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { groupByDay, mergeMessages, messageTime } from '../lib/chat';
import { CorrectionEditor, DiffText } from './CorrectionEditor';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/** Runs an action; resolves to the error message, or null when it worked. */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return message(e);
  }
}

interface MessageActions {
  correct(messageId: number, corrected: string): Promise<string | null>;
  thank(correctionId: number, messageId: number): Promise<string | null>;
  remove(messageId: number): Promise<string | null>;
  report(m: ChatMessage): void;
}

/**
 * One message: plain text with its newlines, yours on the right. Under it, the corrections as diffs with Thanks
 * for the sender, and its actions: Suggest a correction and Report on theirs, Delete (confirmed inline) on yours.
 */
function MessageItem({ m, myId, otherName, open, actions }: {
  m: ChatMessage;
  myId: string;
  otherName: string;
  /** The conversation is accepted: corrections can be suggested. */
  open: boolean;
  actions: MessageActions;
}) {
  const mine = m.senderId === myId;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const corrected = m.corrections.some((k) => k.authorId === myId);

  async function run(action: () => Promise<string | null>, done?: () => void) {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure);
    else done?.();
  }

  return (
    <li className={`chat-message${mine ? ' is-mine' : ''}`}>
      {m.deleted ? <p className="chat-bubble is-deleted">Message deleted</p> : <p className="chat-bubble">{m.body}</p>}
      <div className="chat-meta">
        <time className="chat-time" dateTime={m.createdAt}>{messageTime(m.createdAt)}</time>
        {!m.deleted && !editing && !confirming && (
          <span className="chat-actions">
            {!mine && open && !corrected && <Button variant="quiet" onClick={() => setEditing(true)}>Suggest a correction</Button>}
            {!mine && <Button variant="quiet" onClick={() => actions.report(m)}>Report</Button>}
            {mine && <Button variant="quiet" onClick={() => setConfirming(true)}>Delete</Button>}
          </span>
        )}
      </div>
      {m.corrections.map((k) => (
        <div className="chat-correction" key={k.id}>
          <p className="chat-correction-who">{k.authorId === myId ? 'Your correction' : `${otherName} suggested`}</p>
          <DiffText before={m.body} after={k.corrected} />
          {k.thanked ? (
            <p className="chat-thanked">Thanked</p>
          ) : mine ? (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => actions.thank(k.id, m.id))}>Thanks</Button>
          ) : null}
        </div>
      ))}
      {editing && (
        <CorrectionEditor original={m.body} name={otherName}
          onSubmit={async (text) => {
            const failure = await actions.correct(m.id, text);
            if (!failure) setEditing(false);
            return failure;
          }}
          onCancel={() => setEditing(false)} />
      )}
      {confirming && (
        <div className="chat-confirm" role="group" aria-label="Delete this message">
          <p>Delete this message? Its corrections go too. This cannot be undone.</p>
          <div className="row-actions">
            <Button variant="secondary" busy={busy} autoFocus onClick={() => void run(() => actions.remove(m.id), () => setConfirming(false))}>Delete</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}

/** What the coach would change in your draft; nothing is saved and you choose which version to send. */
function CoachCheck({ draft, check, onUse, onKeep }: { draft: string; check: ChatCheck; onUse(text: string): void; onKeep(): void }) {
  const version = applyCorrections(draft, check.corrections);
  const same = version === draft;
  return (
    <section className="chat-check" aria-label="The coach on your draft">
      {same ? (
        <p className="chat-check-none">The coach found nothing to change.</p>
      ) : (
        <>
          <DiffText before={draft} after={version} />
          <ul className="chat-check-notes">
            {check.corrections.filter((c) => draft.includes(c.original)).map((c, i) => (
              <li key={i}><span className="chat-check-edit">{c.original} → {c.corrected}</span> {c.explanation}</li>
            ))}
          </ul>
        </>
      )}
      {check.rewrite && check.rewrite !== version && (
        <p className="chat-check-rewrite"><span>A more natural way:</span> {check.rewrite}</p>
      )}
      <div className="row-actions">
        {!same && <Button variant="secondary" onClick={() => onUse(version)}>Use this version</Button>}
        <Button variant="quiet" onClick={onKeep}>{same ? 'Close' : 'Keep mine'}</Button>
      </div>
    </section>
  );
}

/**
 * Enter sends, Shift+Enter starts a new line; the counter turns amber past the limit. "Check with the coach" sends
 * only this draft to your coach; a failed check shows its error and Send keeps working.
 */
function Composer({ name, onSend }: { name: string; onSend(body: string): Promise<string | null> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ draft: string; result: ChatCheck } | null>(null);
  const length = text.trim().length;
  const ready = chatText(text) !== null;

  function edit(next: string) {
    setText(next);
    setCheck(null);
  }

  async function send() {
    const body = chatText(text);
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const failed = await onSend(body);
    setBusy(false);
    if (failed) setError(failed);
    else edit('');
  }

  async function askCoach() {
    const draft = chatText(text);
    if (!draft || checking) return;
    setChecking(true);
    setError(null);
    try {
      setCheck({ draft, result: unwrap(await api().chat.check(draft)) });
    } catch (e) {
      setError(message(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="chat-compose">
      {check && check.draft === chatText(text) && (
        <CoachCheck draft={check.draft} check={check.result} onUse={edit} onKeep={() => setCheck(null)} />
      )}
      <label className="visually-hidden" htmlFor="chat-input">Message to {name}</label>
      <textarea id="chat-input" className="textarea chat-input" rows={2} value={text} maxLength={CHAT_TEXT_MAX * 2}
        placeholder={`Write to ${name}`}
        onChange={(e) => edit(e.target.value)}
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
        <Button variant="secondary" busy={checking} disabled={!ready} onClick={() => void askCoach()}>Check with the coach</Button>
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
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
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
    const failure = await attempt(async () => unwrap(await api().chat.send(id, body)));
    if (!failure) {
      stickToBottom.current = true;
      await refresh();
    }
    return failure;
  }

  const actions = useMemo<MessageActions>(() => {
    /** Reloads the page that holds one message, so a change to an older message shows too; the view stays put. */
    const around = async (messageId: number) => {
      stickToBottom.current = false;
      const page = unwrap(await api().chat.messages(id, messageId + 1));
      setMessages((current) => mergeMessages(current ?? [], page));
    };
    return {
      correct: (messageId, corrected) =>
        attempt(async () => {
          unwrap(await api().chat.correct(messageId, corrected));
          await around(messageId);
        }),
      thank: (correctionId, messageId) =>
        attempt(async () => {
          unwrap(await api().chat.thank(correctionId));
          await around(messageId);
        }),
      remove: (messageId) =>
        attempt(async () => {
          unwrap(await api().chat.delete(messageId));
          await around(messageId);
          changed.current();
        }),
      report: (m) => setReporting(m),
    };
  }, [id]);

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
              {g.messages.map((m) => (
                <MessageItem key={m.id} m={m} myId={myId} otherName={other.displayName} open={summary.status === 'accepted'} actions={actions} />
              ))}
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
      <ReportDialog open={reporting !== null} targetName={other.displayName} onClose={() => setReporting(null)}
        onSubmit={async ({ reason, details }) => {
          if (!reporting) return null;
          const contextId = String(reporting.id);
          return attempt(async () => unwrap(await api().safety.report({ reported: other.id, contextType: 'message', contextId, reason, details })));
        }} />
    </section>
  );
}
