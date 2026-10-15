import { useCallback, useEffect, useState } from 'react';
import { localDay, type PracticeGraphData } from '../../core/progress/practice';
import type { Badge, SocialProfile } from '../../core/social/types';
import type { SocialNotice, SocialStatus } from '../../shared/ipc-contract';
import { Avatar, BadgeRow, Banner, Button, EmptyState, Notice, PracticeGraph, Skeleton, StackList } from '../design-system';
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
  banner: string | null;
  badges: Badge[];
  graph: PracticeGraphData;
  notices: SocialNotice[];
}

const NO_GRAPH: PracticeGraphData = { days: [], current: 0, longest: 0 };

function suspendedText(until: string): string {
  return until === 'infinity' ? 'Your account is suspended.' : `Your account is suspended until ${formatLongDate(until)}.`;
}

function ProfileView({ profile, avatar, banner, badges, graph }: Omit<Loaded, 'status' | 'notices' | 'profile'> & { profile: SocialProfile }) {
  const byDay = [...profile.availability].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.from.localeCompare(b.from));
  const today = localDay(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  return (
    <article className="profile">
      <Banner src={banner} />
      <header className="profile-head">
        <span className="profile-avatar">
          <Avatar src={avatar} name={profile.displayName} size={96} userId={profile.id} mascot={profile.mascot} />
        </span>
        <div className="profile-name">
          <h2>{profile.displayName}</h2>
          <p className="lede">{AREA_LABELS[profile.area]} developer, English level {profile.level}</p>
        </div>
      </header>
      <BadgeRow badges={badges} />
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
      <section className="profile-graph" aria-labelledby="profile-practice">
        <h3 id="profile-practice">Practice</h3>
        {!profile.showProgress && (
          <p className="muted small">Only you see this. Other members do not see your practice graph or progress badges.</p>
        )}
        {graph.days.length > 0 ? (
          <PracticeGraph days={graph.days} current={graph.current} longest={graph.longest} today={today} />
        ) : (
          <p className="muted">No practice shared yet. Days appear here a few seconds after you answer or review.</p>
        )}
      </section>
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
        setData({ status, profile: null, avatar: null, banner: null, badges: [], graph: NO_GRAPH, notices: [] });
        return;
      }
      const profile = unwrap(await api().social.getProfile());
      const [avatar, banner, badges, graph, notices] = await Promise.all([
        profile?.hasAvatar ? api().social.avatar(profile.id).then(unwrap) : null,
        profile?.hasBanner ? api().social.banner(profile.id).then(unwrap) : null,
        profile ? api().social.badges(profile.id).then(unwrap) : [],
        profile ? api().social.practiceGraph(profile.id).then(unwrap) : NO_GRAPH,
        api().social.notices().then((r) => unwrap(r).filter((n) => !n.read)),
      ]);
      setData({ status, profile, avatar, banner, badges, graph, notices });
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

  const { status, profile, avatar, banner, badges, graph, notices } = data;
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
            <li>Members see your profile and badges, never your e-mail or what you write when you practise.</li>
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
          userId={profile.id}
          initialBanner={banner}
          initial={{
            displayName: profile.displayName,
            nativeLanguage: profile.nativeLanguage,
            level: profile.level,
            timezone: profile.timezone,
            area: profile.area,
            stack: profile.stack,
            availability: profile.availability,
            bio: profile.bio,
            mainStack: profile.mainStack,
            showProgress: profile.showProgress,
            mascot: profile.mascot,
            listed: profile.listed,
          }}
          onCancel={go('#/people')}
          onSubmit={async (p, photo, newBanner) => {
            const failure = await saveProfileAndPhoto(p, photo, newBanner);
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
          action={<Button variant="quiet" onClick={async () => {
            try {
              unwrap(await api().social.readNotice(n.id));
              void load();
            } catch (e) {
              setError(message(e));
            }
          }}>Mark as read</Button>} />
      ))}
      <ProfileView profile={profile} avatar={avatar} banner={banner} badges={badges} graph={graph} />
      <section className="people-next">
        <EmptyState title="Finding partners comes next"
          body="Soon you will see developers at your level here and practise with them in a 1:1 chat with corrections. Your profile is what they will see." />
      </section>
    </main>
  );
}
