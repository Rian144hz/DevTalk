import { useCallback, useEffect, useState } from 'react';
import type { PracticeGraphData } from '../../core/progress/practice';
import type { SocialStats } from '../../core/social/types';
import type { Result } from '../../shared/ipc-contract';
import { BlockButton, Button, EmptyState, Notice, ReportDialog, Skeleton, SocialActions } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { applyFollow, applyLike } from '../lib/social';
import { ProfileView, type ProfileData } from './ProfileView';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
const NO_GRAPH: PracticeGraphData = { days: [], current: 0, longest: 0 };
const toMembers = () => {
  window.location.hash = '#/people';
};

/** Another member's profile with Follow, like, Report and Block. Gone, blocked or suspended → a plain "not available". */
export function MemberProfile({ userId, myId }: { userId: string; myId: string }) {
  const [data, setData] = useState<ProfileData | null | 'gone'>(null);
  const [stats, setStats] = useState<SocialStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setData(null);
    try {
      const profile = unwrap(await api().social.profileOf(userId));
      if (!profile) {
        setData('gone');
        return;
      }
      const [avatar, banner, badges, graph, social] = await Promise.all([
        profile.hasAvatar ? api().social.avatar(userId).then(unwrap) : null,
        profile.hasBanner ? api().social.banner(userId).then(unwrap) : null,
        api().social.badges(userId).then(unwrap),
        profile.showProgress ? api().social.practiceGraph(userId).then(unwrap) : NO_GRAPH,
        api().social.socialStats(userId).then(unwrap),
      ]);
      setData({ profile, avatar, banner, badges, graph });
      setStats(social);
    } catch (e) {
      setLoadError(message(e));
    }
  }, [userId]);

  useEffect(() => {
    if (userId === myId) {
      window.location.hash = '#/people/me';
      return;
    }
    void load();
  }, [load, userId, myId]);

  /** Shows the change at once and puts it back if the server refuses it. */
  async function change(next: SocialStats, send: () => Promise<Result<null>>) {
    if (busy || !stats) return;
    const before = stats;
    setStats(next);
    setBusy(true);
    setError(null);
    try {
      unwrap(await send());
    } catch (e) {
      setStats(before);
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <Notice tone="error" title={loadError} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />;
  }
  if (data === 'gone') {
    return (
      <EmptyState title="This profile is not available."
        body="The member may have left, been suspended, or blocked you."
        action={<Button variant="secondary" onClick={toMembers}>Back to Members</Button>} />
    );
  }
  if (!data || !stats) {
    return <div className="profile-skeleton" aria-busy="true"><Skeleton width="30%" /><Skeleton width="60%" /><Skeleton width="45%" /></div>;
  }

  const name = data.profile.displayName;
  return (
    <>
      <ProfileView {...data} own={false}
        actions={
          <SocialActions userId={userId} name={name} stats={stats} self={false} busy={busy}
            onFollow={() => void change(applyFollow(stats, !stats.iFollow), () => (stats.iFollow ? api().social.unfollow(userId) : api().social.follow(userId)))}
            onLike={() => void change(applyLike(stats, !stats.iLike), () => (stats.iLike ? api().social.unlike(userId) : api().social.like(userId)))} />
        } />
      {error && <Notice tone="error" title={error} />}
      <section className="profile-safety" aria-label="Safety">
        <Button variant="quiet" onClick={() => setReporting(true)}>Report {name}</Button>
        <BlockButton name={name} onBlock={async () => {
          try {
            unwrap(await api().safety.block(userId));
            toMembers();
            return null;
          } catch (e) {
            return message(e);
          }
        }} />
      </section>
      <ReportDialog open={reporting} targetName={name} onClose={() => setReporting(false)}
        onSubmit={async ({ reason, details }) => {
          try {
            unwrap(await api().safety.report({ reported: userId, contextType: 'profile', contextId: null, reason, details }));
            return null;
          } catch (e) {
            return message(e);
          }
        }} />
    </>
  );
}
