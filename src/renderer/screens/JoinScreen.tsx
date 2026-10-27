import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ProfileDraft } from '../../core/social/types';
import type { SocialStatus } from '../../shared/ipc-contract';
import { useAppData } from '../app/AppData';
import { Icon } from '../app/icons';
import { Button, EmptyState, Notice, Skeleton, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { secondsUntilResend } from '../lib/resend';
import { setReturnTo } from '../lib/returnTo';
import { useGitHubPrefill } from '../lib/useGitHubPrefill';
import { useGitHubSignIn } from '../lib/useGitHubSignIn';
import { GitHubButton, GitHubWaiting } from './GitHubSignIn';
import { LEGAL_TITLES, type LegalDoc } from './LegalScreen';
import { ProfileForm, type PhotoChange, type BannerChange } from './ProfileForm';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/** Survives a visit to a legal document and back. */
const draft = {
  email: '',
  sentAt: 0,
  ticks: { terms: false, privacy: false, conduct: false, age: false },
};

/** Saves the profile, then the photo change. Shared by Join and Edit profile. */
export async function saveProfileAndPhoto(profile: ProfileDraft, photo: PhotoChange, banner: BannerChange = null): Promise<string | null> {
  try {
    unwrap(await api().social.saveProfile(profile));
    if (photo === 'remove') unwrap(await api().social.removeAvatar());
    else if (photo) unwrap(await api().social.setAvatar(photo.bytes));
    if (banner === 'remove') unwrap(await api().social.removeBanner());
    else if (banner) unwrap(await api().social.setBanner(banner.bytes));
    return null;
  } catch (e) {
    return message(e);
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** The page in People, or, in the first run, a column like the coach setup (there is no sidebar yet). */
function JoinFrame({ embedded, busy, children }: { embedded: boolean; busy?: boolean; children: ReactNode }) {
  if (!embedded) return <main className="page join" aria-busy={busy || undefined}>{children}</main>;
  return (
    <main className="onboarding join-embedded" aria-busy={busy || undefined}>
      <div className="onboarding-col">
        <div className="brand"><Icon name="pencil" size={18} />DevTalk</div>
        {children}
      </div>
    </main>
  );
}

/**
 * The community steps: sign in (GitHub or an e-mail code), rules and 18+, profile. A route in People, or `embedded`
 * in the first run, where `onDone` replaces the move to People, `onBack` (the sign-in step) returns to the welcome
 * screen and `onSkip` (the rules and the profile) goes on to the coach setup without finishing.
 */
export function JoinScreen({ embedded = false, onDone, onBack, onSkip }: {
  embedded?: boolean;
  onDone?(): void;
  onBack?(): void;
  onSkip?(): void;
} = {}) {
  const { profile } = useAppData();
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState(draft.email);
  const [sentTo, setSentTo] = useState(draft.sentAt ? draft.email : '');
  const [code, setCode] = useState('');
  const [ticks, setTicks] = useState(draft.ticks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(!!sentTo);
  const finished = useRef(onDone);
  finished.current = onDone;
  const github = useGitHubSignIn((next) => {
    draft.sentAt = 0;
    setSentTo('');
    setError(null);
    setStatus(next);
  });
  // The profile step offers what GitHub knows (nothing for an e-mail member); the main process decides.
  const prefill = useGitHubPrefill(!!status?.signedIn && !status.needsDocuments && !status.hasProfile);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(unwrap(await api().social.status()));
    } catch (e) {
      setLoadError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
    setReturnTo('#/join', 'Back to joining');
  }, [load]);
  useEffect(() => {
    draft.ticks = ticks;
  }, [ticks]);
  useEffect(() => {
    if (!(status?.signedIn && !status.needsDocuments && status.hasProfile)) return;
    if (finished.current) finished.current();
    else window.location.hash = '#/people';
  }, [status]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (to: string) =>
    run(async () => {
      unwrap(await api().social.sendCode(to));
      draft.email = to;
      draft.sentAt = Date.now();
      setSentTo(to);
      setCode('');
    });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const next = unwrap(await api().social.verifyCode(sentTo, code.trim()));
      draft.sentAt = 0;
      setSentTo('');
      setStatus(next);
    });
  };

  const acceptDocuments = () =>
    run(async () => {
      setStatus(unwrap(await api().social.acceptDocuments()));
      draft.ticks = { terms: false, privacy: false, conduct: false, age: false };
    });

  if (loadError) {
    return (
      <JoinFrame embedded={embedded}>
        <header className="page-head"><h1>Join the community</h1></header>
        <Notice tone="error" title={loadError} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      </JoinFrame>
    );
  }
  if (!status) {
    return (
      <JoinFrame embedded={embedded} busy>
        <header className="page-head"><h1>Join the community</h1></header>
        <Skeleton width="50%" /><Skeleton width="70%" />
      </JoinFrame>
    );
  }
  if (!status.configured) {
    return (
      <JoinFrame embedded={embedded}>
        <header className="page-head"><h1>Join the community</h1></header>
        <EmptyState title="Community is not set up in this build" body="This copy of DevTalk has no community server. Your practice works as usual." />
      </JoinFrame>
    );
  }

  const step = !status.signedIn ? (sentTo ? 2 : 1) : status.needsDocuments ? 3 : 4;
  const LEDES = [
    'Sign in or create an account with GitHub or your e-mail. DevTalk has no password.',
    'Check your e-mail for a code.',
    'Read and accept the community rules.',
    'Tell other developers who you are.',
  ];
  const resendIn = secondsUntilResend(draft.sentAt, now);
  const allTicked = ticks.terms && ticks.privacy && ticks.conduct && ticks.age;
  const docRow = (doc: LegalDoc, key: 'terms' | 'privacy' | 'conduct') => (
    <li className="consent-row" key={doc}>
      <label>
        <input type="checkbox" checked={ticks[key]} onChange={(e) => setTicks({ ...ticks, [key]: e.target.checked })} />
        <span>I accept the {LEGAL_TITLES[doc]}</span>
      </label>
      <a href={`#/legal/${doc}`}>Read the {LEGAL_TITLES[doc]}</a>
    </li>
  );

  const skip = embedded && onSkip ? <Button variant="quiet" onClick={onSkip}>Skip for now</Button> : null;
  return (
    <JoinFrame embedded={embedded}>
      <header className="join-head">
        <h1>Join the community</h1>
        <p className="lede">Step {step} of 4. {LEDES[step - 1]}</p>
      </header>

      {step === 1 && (github.waiting ? (
        <section className="join-step" aria-label="Signing in with GitHub">
          <GitHubWaiting onCancel={github.cancel} />
        </section>
      ) : (
        <section className="join-step" aria-labelledby="join-start">
          <h2 id="join-start">Sign in</h2>
          {github.error && <Notice tone="error" title={github.error} />}
          <GitHubButton onClick={github.start} />
          <p className="or-rule" aria-hidden="true">or</p>
          <form className="join-email" onSubmit={(e) => { e.preventDefault(); void sendCode(email.trim().toLowerCase()); }}>
            <TextField label="E-mail" type="email" value={email} onChange={(e) => { setEmail(e.target.value); draft.email = e.target.value; }}
              autoComplete="email" spellCheck={false} hint="We send a code to this address. Other members never see it." autoFocus />
            {error && <Notice tone="error" title={error} />}
            <div className="form-actions">
              {embedded && onBack && <Button variant="quiet" onClick={onBack}>Back</Button>}
              <Button variant="secondary" type="submit" busy={busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>Send code</Button>
            </div>
          </form>
        </section>
      ))}

      {step === 2 && (
        <form className="join-step" onSubmit={verify}>
          <h2>Enter the code</h2>
          <p>We sent a code to <strong>{sentTo}</strong>. It can take a minute to arrive; check your spam folder too.</p>
          <TextField label="Code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" autoComplete="one-time-code" maxLength={10} spellCheck={false} autoFocus />
          {error && <Notice tone="error" title={error} />}
          <div className="form-actions spread">
            <div className="row-actions">
              <Button variant="quiet" onClick={() => { draft.sentAt = 0; setSentTo(''); setError(null); }}>Use another e-mail</Button>
              <Button variant="quiet" disabled={resendIn > 0 || busy} onClick={() => void sendCode(sentTo)}>
                {resendIn > 0 ? `Send a new code (${resendIn} s)` : 'Send a new code'}
              </Button>
            </div>
            <Button variant="primary" type="submit" busy={busy} disabled={!/^\d{6,10}$/.test(code)}>Continue</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <section className="join-step" aria-labelledby="join-docs">
          <h2 id="join-docs">Community rules</h2>
          <p>They are short and in plain English. You can read them again later in Settings.</p>
          <ul className="consents">
            {docRow('terms', 'terms')}
            {docRow('privacy', 'privacy')}
            {docRow('conduct', 'conduct')}
            <li className="consent-row" key="age">
              <label>
                <input type="checkbox" checked={ticks.age} onChange={(e) => setTicks({ ...ticks, age: e.target.checked })} />
                <span>I am 18 or older</span>
              </label>
            </li>
          </ul>
          {error && <Notice tone="error" title={error} />}
          <div className="form-actions">
            {skip}
            <Button variant="primary" busy={busy} disabled={!allTicked} onClick={() => void acceptDocuments()}>Continue</Button>
          </div>
        </section>
      )}

      {step === 4 && (prefill === null ? (
        <section className="join-step" aria-busy="true" aria-label="Your profile">
          <Skeleton width="40%" /><Skeleton width="70%" />
        </section>
      ) : (
        <section className="join-step" aria-labelledby="join-profile">
          <h2 id="join-profile">Your profile</h2>
          <p>Other members see this. Your e-mail stays private.</p>
          <ProfileForm
            submitLabel="Join"
            initialAvatar={null}
            suggestedPhoto={prefill.photo}
            extraAction={skip}
            initial={{
              displayName: prefill.displayName,
              nativeLanguage: profile?.nativeLanguage ?? 'Portuguese (Brazil)',
              level: profile?.currentLevel ?? 'B1',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              area: 'backend',
              stack: [],
              availability: [],
              bio: '',
              mainStack: [],
              showProgress: true,
              mascot: null,
              listed: true,
            }}
            onSubmit={async (p, photo) => {
              const failure = await saveProfileAndPhoto(p, photo);
              if (failure) return failure;
              if (finished.current) finished.current();
              else window.location.hash = '#/people/me';
              return null;
            }}
          />
        </section>
      ))}
    </JoinFrame>
  );
}
