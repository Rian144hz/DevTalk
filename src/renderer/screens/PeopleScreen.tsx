import { useCallback, useEffect, useState } from 'react';
import type { PracticeGraphData } from '../../core/progress/practice';
import type { Badge, SocialProfile, SocialStats } from '../../core/social/types';
import type { SocialNotice, SocialStatus } from '../../shared/ipc-contract';
import { Avatar, Button, EmptyState, Notice, Skeleton, SocialActions } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { formatLongDate } from '../lib/format';
import { setReturnTo } from '../lib/returnTo';
import type { Route } from '../lib/router';
import { saveProfileAndPhoto } from './JoinScreen';
import { FollowList } from './FollowList';
import { MemberProfile } from './MemberProfile';
import { MembersTab } from './MembersTab';
import { ProfileView } from './ProfileView';
import { PagedMembers } from './PagedMembers';
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
  stats: SocialStats;
  notices: SocialNotice[];
}

const NO_STATS: SocialStats = { followers: 0, following: 0, likes: 0, iFollow: false, iLike: false };

const NO_GRAPH: PracticeGraphData = { days: [], current: 0, longest: 0 };

function suspendedText(until: string): string {
  return until === 'infinity' ? 'Your account is suspended.' : `Your account is suspended until ${formatLongDate(until)}.`;
}

type Tab = 'members' | 'following' | 'me';
const TABS: { id: Tab; label: string; hash: string }[] = [
  { id: 'members', label: 'Members', hash: '#/people' },
  { id: 'following', label: 'Following', hash: '#/people/following' },
  { id: 'me', label: 'Your profile', hash: '#/people/me' },
];

function PeopleTabs({ active }: { active: Tab | null }) {
  return (
    <nav className="people-tabs" aria-label="People">
      {TABS.map((t) => (
        <a key={t.id} href={t.hash} aria-current={active === t.id ? 'page' : undefined}>{t.label}</a>
      ))}
    </nav>
  );
}

export function PeopleScreen({ route }: { route: Route }) {
  const edit = route.sub === 'edit';
  const tab: Tab | null = route.userId ? null : route.sub === 'me' ? 'me' : route.sub === 'following' ? 'following' : 'members';
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const status = unwrap(await api().social.status());
      if (!status.signedIn || status.needsDocuments || !status.hasProfile) {
        setData({ status, profile: null, avatar: null, banner: null, badges: [], graph: NO_GRAPH, stats: NO_STATS, notices: [] });
        return;
      }
      const profile = unwrap(await api().social.getProfile());
      const [avatar, banner, badges, graph, stats, notices] = await Promise.all([
        profile?.hasAvatar ? api().social.avatar(profile.id).then(unwrap) : null,
        profile?.hasBanner ? api().social.banner(profile.id).then(unwrap) : null,
        profile ? api().social.badges(profile.id).then(unwrap) : [],
        profile ? api().social.practiceGraph(profile.id).then(unwrap) : NO_GRAPH,
        profile ? api().social.socialStats(profile.id).then(unwrap) : NO_STATS,
        api().social.notices().then((r) => unwrap(r).filter((n) => !n.read)),
      ]);
      setData({ status, profile, avatar, banner, badges, graph, stats, notices });
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

  const { status, profile, avatar, banner, badges, graph, stats, notices } = data;
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
          onCancel={go('#/people/me')}
          onSubmit={async (p, photo, newBanner) => {
            const failure = await saveProfileAndPhoto(p, photo, newBanner);
            if (!failure) window.location.hash = '#/people/me';
            return failure;
          }}
        />
      </main>
    );
  }

  // Suspended members only see their own profile; the member list is closed to them until the end date.
  const showing: Tab | null = suspended ? 'me' : tab;
  return (
    <main className="page people">
      {head(!suspended && showing === 'me' ? <Button variant="secondary" onClick={go('#/people/edit')}>Edit profile</Button> : undefined)}
      {suspended && (
        <Notice tone="info" title={suspendedText(suspended)} detail="Until then you cannot edit your profile or send reports." />
      )}
      {notices.map((n) => {
        const markRead = (
          <Button variant="quiet" onClick={async () => {
            try {
              unwrap(await api().social.readNotice(n.id));
              void load();
            } catch (e) {
              setError(message(e));
            }
          }}>Mark as read</Button>
        );
        if (n.kind === 'follow' && n.actor) {
          return (
            <div key={n.id} className="notice follow-notice" data-tone="info" role="status">
              <Avatar src={null} name={n.actor.displayName} size={32} userId={n.actor.id} />
              <p><a href={`#/people/u/${n.actor.id}`}>{n.actor.displayName}</a> followed you. <span className="notice-detail">{formatLongDate(n.createdAt)}</span></p>
              {markRead}
            </div>
          );
        }
        return (
          <Notice key={n.id} tone="info" title={n.kind === 'follow' ? 'New follower' : 'Message from the moderators'}
            detail={`${n.message} (${formatLongDate(n.createdAt)})`} action={markRead} />
        );
      })}
      {!suspended && <PeopleTabs active={showing} />}
      {showing === 'members' && <MembersTab />}
      {showing === 'following' && (
        <PagedMembers
          reloadKey="following"
          label="Following"
          load={(page) => api().social.following(profile.id, page).then(unwrap)}
          empty={<EmptyState title="You do not follow anyone yet." body="Find people in Members." action={<Button variant="secondary" onClick={go('#/people')}>Go to Members</Button>} />}
        />
      )}
      {showing === 'me' && (
        <>
          <ProfileView profile={profile} avatar={avatar} banner={banner} badges={badges} graph={graph} own
            actions={<SocialActions userId={profile.id} name={profile.displayName} stats={stats} self />} />
          <section className="people-next">
            <EmptyState title="Private messages come next"
              body="Soon you can send a private message to a member from their profile and practise together." />
          </section>
        </>
      )}
      {showing === null && route.userId && !route.list && <MemberProfile userId={route.userId} myId={profile.id} />}
      {showing === null && route.userId && route.list && (
        <FollowList userId={route.userId} list={route.list} myId={profile.id} myName={profile.displayName} />
      )}
    </main>
  );
}
