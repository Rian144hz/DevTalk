import { useEffect, useState } from 'react';
import { Button, EmptyState, Skeleton } from '../design-system';
import { api, unwrap } from '../lib/api';
import { PagedMembers } from './PagedMembers';

/** Who follows a member, or whom they follow. Hidden or blocked members are not available here either. */
export function FollowList({ userId, list, myId, myName }: { userId: string; list: 'followers' | 'following'; myId: string; myName: string }) {
  const [name, setName] = useState<string | null | 'gone'>(userId === myId ? myName : null);

  useEffect(() => {
    if (userId === myId) {
      setName(myName);
      return;
    }
    let alive = true;
    setName(null);
    api().social.profileOf(userId).then(
      (r) => alive && setName(r.ok && r.data ? r.data.displayName : 'gone'),
      () => alive && setName('gone'),
    );
    return () => {
      alive = false;
    };
  }, [userId, myId, myName]);

  const back = userId === myId ? '#/people/me' : `#/people/u/${userId}`;
  if (name === 'gone') {
    return (
      <EmptyState title="This profile is not available." body="The member may have left, been suspended, or blocked you."
        action={<Button variant="secondary" onClick={() => { window.location.hash = '#/people'; }}>Back to Members</Button>} />
    );
  }
  if (name === null) return <div className="member-skeleton" aria-busy="true"><Skeleton width="40%" /><Skeleton width="60%" /></div>;

  const title = list === 'followers' ? `${name}'s followers` : `People ${name} follows`;
  return (
    <section className="follow-list" aria-labelledby="follow-list-title">
      <a className="back-link" href={back}>Back to {userId === myId ? 'your profile' : `${name}'s profile`}</a>
      <h2 id="follow-list-title">{title}</h2>
      <PagedMembers
        reloadKey={`${userId}/${list}`}
        label={title}
        load={(page) => (list === 'followers' ? api().social.followers(userId, page) : api().social.following(userId, page)).then(unwrap)}
        empty={<EmptyState title={list === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'} body="Members you can see appear here." />}
      />
    </section>
  );
}
