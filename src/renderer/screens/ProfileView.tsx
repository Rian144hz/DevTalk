import type { ReactNode } from 'react';
import { localDay, type PracticeGraphData } from '../../core/progress/practice';
import type { Badge, SocialProfile } from '../../core/social/types';
import { Avatar, BadgeRow, Banner, PracticeGraph, StackList } from '../design-system';
import { formatSlot } from '../lib/format';
import { AREA_LABELS } from './forms';

export interface ProfileData {
  profile: SocialProfile;
  avatar: string | null;
  banner: string | null;
  badges: Badge[];
  graph: PracticeGraphData;
}

/**
 * A member's profile, Discord style: banner, overlapping picture, badges, facts and the practice graph.
 * `own` adds the "only you see this" note when progress is hidden; `actions` sit under the name.
 */
export function ProfileView({ profile, avatar, banner, badges, graph, own, actions }: ProfileData & { own: boolean; actions?: ReactNode }) {
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
      {actions}
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
        {own && !profile.showProgress && (
          <p className="muted small">Only you see this. Other members do not see your practice graph or progress badges.</p>
        )}
        {!own && !profile.showProgress ? (
          <p className="muted">{profile.displayName} keeps their practice private.</p>
        ) : graph.days.length > 0 ? (
          <PracticeGraph days={graph.days} current={graph.current} longest={graph.longest} today={today} />
        ) : (
          <p className="muted">{own ? 'No practice shared yet. Days appear here a few seconds after you answer or review.' : 'No practice yet.'}</p>
        )}
      </section>
    </article>
  );
}
