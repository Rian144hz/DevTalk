import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { findSecret, SECRET_MESSAGE } from '../../core/check/secrets';
import {
  CHECK_TEXT_MAX, CHECK_TYPES, CHECK_TYPE_LABELS, checkPrivacyNote, checkText, checkToneHint, type CheckResult, type CheckType,
} from '../../core/check/types';
import type { ExpressionDraft } from '../../core/domain/types';
import { buildGalley } from '../../core/feedback/galley';
import { DEFAULT_PROVIDER, type ProviderId } from '../../shared/providers';
import { useAppData } from '../app/AppData';
import { Icon } from '../app/icons';
import { api } from '../lib/api';
import { selectPassage } from '../lib/field';
import { useCoachRequest } from '../lib/useCoachRequest';
import { Button, CoachProgress, ExpressionCard, Galley, Notice, Select, TextArea } from '../design-system';
import { errorAction } from './errorCopy';
import { CopyButton, editsLabel, markExpressions } from './FeedbackScreen';

const TYPE_OPTIONS = CHECK_TYPES.map((value) => ({ value, label: CHECK_TYPE_LABELS[value] }));

/**
 * Check text: a real text (a pull request, a Slack message, an e-mail…) is corrected and rewritten in the same tone.
 * Nothing is saved. The text lives in this component only, so leaving the screen or reloading empties it. Only the
 * expressions the person keeps go to Review.
 */
export function CheckScreen() {
  const { profile } = useAppData();
  const provider = (profile?.provider ?? DEFAULT_PROVIDER) as ProviderId;
  const [type, setType] = useState<CheckType>('pull_request');
  const [text, setText] = useState('');
  /** What the last check was about: the result is shown against this text, even if the field changes after. */
  const [checked, setChecked] = useState<{ text: string; type: CheckType } | null>(null);
  const req = useCoachRequest<CheckResult>((id) => api().check.cancel(id));
  const field = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const running = req.state.status === 'running';
  const done = req.state.status === 'done';
  // The passage is found at once, as the person types, and it is a position in the field's own text.
  const secret = useMemo(() => findSecret(text), [text]);
  const length = text.trim().length;
  const tooLong = length > CHECK_TEXT_MAX;
  const error = secret ? SECRET_MESSAGE : tooLong ? `Use ${CHECK_TEXT_MAX} characters or fewer (now ${length}).` : undefined;

  function run() {
    if (running) return;
    if (secret) {
      // Nothing is sent: the field takes the focus and the passage is selected, so it can be deleted.
      if (field.current) selectPassage(field.current, secret.start, secret.end);
      return;
    }
    const body = checkText(text);
    if (body === null) return;
    setChecked({ text: body, type });
    req.run((requestId) => api().check.run({ requestId, type, text: body }));
  }

  // A result below the fold is brought into view.
  useEffect(() => {
    if (done) resultRef.current?.scrollIntoView({ block: 'start' });
  }, [done]);

  return (
    <main className="page check">
      <header className="page-head"><h1>Check</h1></header>
      {/* Always there, so the screen reader hears the change when the result arrives. */}
      <p className="visually-hidden" role="status">{req.state.status === 'done' ? `The coach has finished. ${editsLabel(req.state.data.corrections.length)}.` : ''}</p>
      <form className="check-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Select label="What are you writing?" value={type} options={TYPE_OPTIONS} disabled={running}
          onChange={(e) => setType(e.target.value as CheckType)} />
        <TextArea ref={field} label="Your text" value={text} onChange={(e) => setText(e.target.value)} readOnly={running} spellCheck
          placeholder="Paste or write the text you want to check."
          hint={`${length} / ${CHECK_TEXT_MAX} characters`} error={error}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              run();
            }
          }} />
        <p className="check-note">{checkPrivacyNote(provider)}</p>
        <div className="answer-actions">
          <Button type="submit" variant="primary" shortcut="Ctrl Enter" busy={running} disabled={checkText(text) === null}>
            {done ? 'Check again' : 'Check'}
          </Button>
        </div>
      </form>

      {req.state.status === 'running' && (
        <div className="check-status">
          <CoachProgress stage={req.state.stage} startedAt={req.state.startedAt} onCancel={req.cancel} label="The coach is reading your text" />
        </div>
      )}
      {req.state.status === 'error' && (
        <div className="check-status">
          <Notice tone="error" title={req.state.error.message} detail="Your text is kept."
            action={errorAction(req.state.error.kind) === 'settings'
              ? <Button variant="secondary" onClick={() => { window.location.hash = '#/settings'; }}>Open Settings</Button>
              : <Button variant="secondary" onClick={run}>Try again</Button>} />
        </div>
      )}
      {req.state.status === 'done' && checked && <CheckResultView ref={resultRef} checked={checked} result={req.state.data} />}
    </main>
  );
}

function CheckResultView({ checked, result, ref }: { checked: { text: string; type: CheckType }; result: CheckResult; ref: Ref<HTMLDivElement> }) {
  const { refresh } = useAppData();
  const galley = useMemo(() => buildGalley(checked.text, result.corrections), [checked.text, result.corrections]);
  return (
    <div className="check-result" ref={ref}>
      <Galley galley={galley} title="Your text" meta={editsLabel(result.corrections.length)} />
      <section aria-labelledby="check-natural" className="fb-section">
        <div className="sec-head"><h2 id="check-natural">Natural version</h2><CopyButton text={result.naturalRewrite} /></div>
        <p className="muted small">{checkToneHint(checked.type)}</p>
        <p className="rewrite">{markExpressions(result.naturalRewrite, result.expressions.map((e) => e.text))}</p>
      </section>
      <section aria-labelledby="check-expressions" className="fb-section">
        <div className="sec-head"><h2 id="check-expressions">Expressions</h2><span className="muted small">Keep the ones you want to review</span></div>
        <div className="exprs">
          {result.expressions.map((e) => (
            <ExpressionCard key={e.text} expression={e} foot={<KeepButton draft={e} onKept={() => void refresh().catch(() => undefined)} />} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Puts one expression into Review. "Kept" afterwards; a failure says so and the button works again. */
function KeepButton({ draft, onKept }: { draft: ExpressionDraft; onKept(): void }) {
  const [state, setState] = useState<'idle' | 'saving' | 'kept' | 'failed'>('idle');
  async function keep() {
    if (state === 'saving' || state === 'kept') return;
    setState('saving');
    try {
      const r = await api().review.keep(draft);
      setState(r.ok ? 'kept' : 'failed');
      if (r.ok) onKept();
    } catch {
      setState('failed');
    }
  }
  return (
    <>
      <Button variant="secondary" busy={state === 'saving'} disabled={state === 'kept'} onClick={() => void keep()}>
        {state === 'kept' ? <><Icon name="check" size={14} />Kept</> : 'Keep in Review'}
      </Button>
      {state === 'failed' && <span className="field-error" role="alert"> Could not keep it. Try again.</span>}
    </>
  );
}
