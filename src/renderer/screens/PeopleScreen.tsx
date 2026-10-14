import { useCallback, useEffect, useState } from 'react';
import type { SocialProfile } from '../../core/social/types';
import type { SocialNotice, SocialStatus } from '../../shared/ipc-contract';
import { Avatar, Button, EmptyState, Notice, Skeleton, StackList } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { formatLongDate, formatSlot } from '../lib/format';
import { setReturnTo } from '../lib/returnTo';
import { AREA_LABELS } from './forms';
import { saveProfileAndPhoto } from './JoinScreen';
import { ProfileForm } from './ProfileForm';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
const go = (hash: string) => () => { window.location.hash = hash; };

interface Loaded {
  status: SocialStatus;
  profile: SocialProfile | null;
  avatar: string | null;
  notices: SocialNotice[];
}

function suspendedText(until: string): string {
  return until === 'infinity' ? 'Your account is suspended.' : `Your account is suspended until ${formatLongDate(until)}.`;
}

function ProfileView({ profile, avatar }: { profile: SocialProfile; avatar: string | null }) {
  const byDay = [...profile.availability].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.from.localeCompare(b.from));
  return (
    <article className="profile">
      <header className="profile-head">
        <Avatar src={avatar} name={profile.displayName} size={72} />
        <div>
          <h2>{profile.displayName}</h2>
          <p className="lede">{AREA_LABELS[profile.area]} developer, English level {profile.level}</p>
        </div>
      </header>
      <dl className="profile-facts">
        <dt>Native language</dt>
        <dd>{profile.nativeLanguage}</dd>
        <dt>Time zone</dt>
        <dd>{profile.timezone}</dd>
        <dt>Stack</dt>
        <dd>{profile.stack.length > 0 ? <StackList tags={profile.stack} /> : <span className="muted">Not added yet</span>}</dd>
        <dt>Available</dt>
        <dd>
          {byDay.length > 0 ? (
            <ul className="slots-read">{byDay.map((s, k) => <li key={k} className="num">{formatSlot(s)}</li>)}</ul>
          ) : (
            <span className="muted">No times added</span>
          )}
        </dd>
        {profile.bio && (
          <>
            <dt>About</dt>
            <dd className="bio">{profile.bio}</dd>
          </>
        )}
      </dl>
    </article>
  );
}

export function PeopleScreen({ edit }: { edit: boolean }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const status = unwrap(await api().social.status());
      if (!status.signedIn || status.needsDocuments || !status.hasProfile) {
        setData({ status, profile: null, avatar: null, notices: [] });
        return;
      }
      const profile = unwrap(await api().social.getProfile());
      const avatar = profile?.hasAvatar ? unwrap(await api().social.avatar(profile.id)) : null;
      const notices = unwrap(await api().social.notices()).filter((n) => !n.read);
      setData({ status, profile, avatar, notices });
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
    setReturnTo('#/people', 'Back to People');
  }, [load, edit]);

  const head = (action?: React.ReactNode, lede?: string) => (
    <header className="page-head">
      <div>
        <h1>People</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {action}
    </header>
  );

  if (error) {
    return (
      <main className="page people">
        {head()}
        <Notice tone="error" title={error} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page people" aria-busy="true">
        {head()}
        <div className="profile-skeleton"><Skeleton width="30%" /><Skeleton width="60%" /><Skeleton width="45%" /></div>
      </main>
    );
  }

  const { status, profile, avatar, notices } = data;
  if (!status.configured) {
    return (
      <main className="page people">
        {head()}
        <EmptyState title="Community is not set up in this build" body="This copy of DevTalk has no community server. Your practice works as usual." />
      </main>
    );
  }
  if (!status.signedIn) {
    return (
      <main className="page people">
        {head(undefined, 'Practise with other developers, not only with the coach.')}
        <section className="people-intro">
          <p>Create a profile now. Next, you will find partners at your level, practise in a 1:1 chat where you correct each other, and join voice rooms.</p>
          <ul className="intro-points">
            <li>Sign in with a code sent to your e-mail. There is no password.</li>
            <li>Members see your profile, never your e-mail or your practice.</li>
            <li>For people 18 or older.</li>
          </ul>
          <div className="row-actions">
            <Button variant="primary" onClick={go('#/join')}>Join the community</Button>
          </div>
        </section>
      </main>
    );
  }
  if (status.needsDocuments || !status.hasProfile || !profile) {
    return (
      <main className="page people">
        {head()}
        <EmptyState
          title="Finish joining"
          body={`You are signed in as ${status.email ?? 'your e-mail'}. Accept the community rules and create your profile to continue.`}
          action={<Button variant="primary" onClick={go('#/join')}>Continue joining</Button>}
        />
      </main>
    );
  }

  const suspended = status.suspendedUntil;
  if (edit && !suspended) {
    return (
      <main className="page people">
        <header className="page-head"><h1>Edit profile</h1></header>
        <ProfileForm
          submitLabel="Save profile"
          initialAvatar={avatar}
          initial={{
            displayName: profile.displayName,
            nativeLanguage: profile.nativeLanguage,
            level: profile.level,
            timezone: profile.timezone,
            area: profile.area,
            stack: profile.stack,
            availability: profile.availability,
            bio: profile.bio,
          }}
          onCancel={go('#/people')}
          onSubmit={async (p, photo) => {
            const failure = await saveProfileAndPhoto(p, photo);
            if (!failure) window.location.hash = '#/people';
            return failure;
          }}
        />
      </main>
    );
  }

  return (
    <main className="page people">
      {head(suspended ? undefined : <Button variant="secondary" onClick={go('#/people/edit')}>Edit profile</Button>)}
      {suspended && (
        <Notice tone="info" title={suspendedText(suspended)} detail="Until then you cannot edit your profile or send reports." />
      )}
      {notices.map((n) => (
        <Notice key={n.id} tone="info" title="Message from the moderators" detail={`${n.message} (${formatLongDate(n.createdAt)})`}
          action={<Button variant="quiet" onClick={async () => { unwrap(await api().social.readNotice(n.id)); void load(); }}>Mark as read</Button>} />
      ))}
      <ProfileView profile={profile} avatar={avatar} />
      <section className="people-next">
        <EmptyState title="Finding partners comes next"
          body="Soon you will see developers at your level here and practise with them in a 1:1 chat with corrections. Your profile is what they will see." />
      </section>
    </main>
  );
}
