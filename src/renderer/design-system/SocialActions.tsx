import type { SocialStats } from '../../core/social/types';
import { Icon } from '../app/icons';
import { followersText, followingText, likesText } from '../lib/social';
import { Button } from './Button';

/**
 * Under a profile's name: Follow / Following and the like button on someone else's profile, then the public counts.
 * Your own profile shows only the counts. Buttons stay disabled while a change is on its way.
 */
export function SocialActions({ userId, name, stats, self, busy, onFollow, onLike, messageHref }: {
  userId: string;
  name: string;
  stats: SocialStats;
  self: boolean;
  busy?: boolean;
  onFollow?(): void;
  onLike?(): void;
  /** Someone else's profile: where "Send message" goes. */
  messageHref?: string;
}) {
  return (
    <div className="social-actions">
      {!self && (
        <Button variant={stats.iFollow ? 'secondary' : 'primary'} disabled={busy} onClick={onFollow}
          aria-label={stats.iFollow ? `Stop following ${name}` : `Follow ${name}`}>
          {stats.iFollow ? 'Following' : 'Follow'}
        </Button>
      )}
      {!self && messageHref && <a className="btn btn-secondary" href={messageHref}>Send message</a>}
      {self ? (
        <span className="social-count"><Icon name="heart" size={14} /> {likesText(stats.likes)}</span>
      ) : (
        <button type="button" className="like-button" aria-pressed={stats.iLike} disabled={busy} onClick={onLike}
          aria-label={`${stats.iLike ? 'Unlike' : 'Like'} ${name}'s profile, ${likesText(stats.likes)}`}>
          <Icon name="heart" size={16} />
          <span className="num">{stats.likes}</span>
        </button>
      )}
      <a className="social-count" href={`#/people/u/${userId}/followers`}>{followersText(stats.followers)}</a>
      <a className="social-count" href={`#/people/u/${userId}/following`}>{followingText(stats.following)}</a>
    </div>
  );
}
