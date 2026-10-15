import { normalizeStackTags } from '../../core/social/validate';
import type { SocialStatus } from '../../shared/ipc-contract';
import { validateAvatar } from '../social/avatar';
import type { SocialBackend } from '../social/backend';
import { prepareBannerUpload } from '../../core/media/banner';
import { AppFailure, handle, type HandlerMap } from './handle';
import type { SocialChannel } from './handlers';

export interface SocialHandlerDeps {
  backend: SocialBackend;
  /** The local study data (practice history, expressions, reviews) as plain JSON. */
  exportLocal: () => Record<string, unknown>;
  /** Shows a save dialog; null when cancelled. */
  chooseSavePath: (defaultName: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => void;
  /** Removes the local database and keys, then restarts the app. */
  deleteLocalData: () => void;
  /** YYYY-MM-DD, for the export file name. */
  today: () => string;
}

const SIGNED_OUT: SocialStatus = {
  configured: true,
  signedIn: false,
  email: null,
  needsDocuments: false,
  hasProfile: false,
  suspendedUntil: null,
};

function activeSuspension(until: string | null | undefined): string | null {
  if (!until) return null;
  return until === 'infinity' || Date.parse(until) > Date.now() ? until : null;
}

export function createSocialHandlers(deps: SocialHandlerDeps): HandlerMap<SocialChannel> {
  const { backend } = deps;

  async function status(): Promise<SocialStatus> {
    if (!backend.configured) return { ...SIGNED_OUT, configured: false };
    const session = await backend.session();
    if (!session) return SIGNED_OUT;
    const needsDocuments = !(await backend.hasAcceptedCurrentDocuments());
    const profile = needsDocuments ? null : await backend.getOwnProfile();
    return {
      configured: true,
      signedIn: true,
      email: session.email,
      needsDocuments,
      hasProfile: profile !== null,
      suspendedUntil: activeSuspension(profile?.suspendedUntil),
    };
  }

  async function requireModerator(): Promise<void> {
    if (!(await backend.isModerator())) throw new AppFailure('forbidden', 'Only moderators can see this.');
  }

  async function refuseSelf(userId: string, message: string): Promise<void> {
    if ((await backend.session())?.userId === userId) throw new AppFailure('validation', message);
  }

  /** Badge changes are for other members; the server refuses them on oneself, so say why before asking it. */
  async function requireOtherMember(userId: string): Promise<void> {
    if ((await backend.session())?.userId === userId) {
      throw new AppFailure('validation', 'You cannot change your own badges. Another moderator can do it.');
    }
  }

  return {
    'social:status': handle('social:status', status),
    'social:sendCode': handle('social:sendCode', async ({ email }) => {
      await backend.sendCode(email);
      return null;
    }),
    'social:verifyCode': handle('social:verifyCode', async ({ email, code }) => {
      await backend.verifyCode(email, code);
      return status();
    }),
    'social:acceptDocuments': handle('social:acceptDocuments', async () => {
      await backend.acceptDocuments();
      return status();
    }),
    'social:getProfile': handle('social:getProfile', () => backend.getOwnProfile()),
    'social:saveProfile': handle('social:saveProfile', (draft) =>
      backend.saveProfile({ ...draft, stack: normalizeStackTags(draft.stack) }),
    ),
    'social:setAvatar': handle('social:setAvatar', async ({ bytes }) => {
      if (validateAvatar(bytes) !== 'ok') throw new AppFailure('validation', 'The photo must be a WebP image under 200 KB.');
      await backend.uploadAvatar(bytes);
      const me = await backend.session();
      return (me && (await backend.avatarDataUrl(me.userId))) ?? '';
    }),
    'social:removeAvatar': handle('social:removeAvatar', async () => {
      await backend.removeAvatar();
      return null;
    }),
    'social:avatar': handle('social:avatar', ({ userId }) => backend.avatarDataUrl(userId)),
    'social:badges': handle('social:badges', ({ userId }) => backend.badges(userId)),
    'social:practiceGraph': handle('social:practiceGraph', ({ userId }) => backend.practiceGraph(userId)),
    'social:setBanner': handle('social:setBanner', async ({ bytes }) => {
      const banner = prepareBannerUpload(bytes);
      if ('error' in banner) {
        throw new AppFailure(
          'validation',
          banner.error === 'corrupt' ? 'This image could not be read. Try another one.' : 'The banner must be a GIF or WebP under 2 MB, at least 600 × 200.',
        );
      }
      await backend.uploadBanner(banner.bytes, banner.ext);
      const me = await backend.session();
      return (me && (await backend.bannerDataUrl(me.userId))) ?? '';
    }),
    'social:removeBanner': handle('social:removeBanner', async () => {
      await backend.removeBanner();
      return null;
    }),
    'social:banner': handle('social:banner', ({ userId }) => backend.bannerDataUrl(userId)),
    'social:members': handle('social:members', ({ page, ...filters }) => backend.members(filters, page)),
    'social:profileOf': handle('social:profileOf', ({ userId }) => backend.profileOf(userId)),
    'social:socialStats': handle('social:socialStats', ({ userId }) => backend.socialStats(userId)),
    'social:follow': handle('social:follow', async ({ userId }) => {
      await refuseSelf(userId, 'You cannot follow yourself.');
      await backend.follow(userId);
      return null;
    }),
    'social:unfollow': handle('social:unfollow', async ({ userId }) => {
      await backend.unfollow(userId);
      return null;
    }),
    'social:like': handle('social:like', async ({ userId }) => {
      await refuseSelf(userId, 'You cannot like your own profile.');
      await backend.like(userId);
      return null;
    }),
    'social:unlike': handle('social:unlike', async ({ userId }) => {
      await backend.unlike(userId);
      return null;
    }),
    'social:followers': handle('social:followers', ({ userId, page }) => backend.followers(userId, page)),
    'social:following': handle('social:following', ({ userId, page }) => backend.following(userId, page)),
    'social:notices': handle('social:notices', () => backend.listNotices()),
    'social:readNotice': handle('social:readNotice', async ({ id }) => {
      await backend.markNoticeRead(id);
      return null;
    }),
    'social:signOut': handle('social:signOut', async () => {
      await backend.signOut();
      return status();
    }),
    'social:export': handle('social:export', async ({ includeLocal }) => {
      const community = await backend.exportOwnData();
      const data: Record<string, unknown> = { app: 'DevTalk', exportedAt: new Date().toISOString(), community };
      if (includeLocal) data['practice'] = deps.exportLocal();
      const path = await deps.chooseSavePath(`devtalk-data-${deps.today()}.json`);
      if (!path) return { saved: false, path: null };
      deps.writeFile(path, JSON.stringify(data, null, 2));
      return { saved: true, path };
    }),
    'social:deleteAccount': handle('social:deleteAccount', async ({ confirmEmail, deleteLocal }) => {
      const session = await backend.session();
      if (!session) throw new AppFailure('not_signed_in');
      if (confirmEmail.trim().toLowerCase() !== session.email.toLowerCase()) {
        throw new AppFailure('validation', 'Type the e-mail of this account to confirm.');
      }
      await backend.deleteAccount();
      if (deleteLocal) deps.deleteLocalData();
      return null;
    }),
    'safety:block': handle('safety:block', async ({ userId }) => {
      await backend.block(userId);
      return null;
    }),
    'safety:unblock': handle('safety:unblock', async ({ userId }) => {
      await backend.unblock(userId);
      return null;
    }),
    'safety:report': handle('safety:report', async (input) => {
      await backend.report(input);
      return null;
    }),
    'moderation:isModerator': handle('moderation:isModerator', () => backend.isModerator()),
    'moderation:reports': handle('moderation:reports', async () => {
      await requireModerator();
      return backend.listOpenReports();
    }),
    'moderation:history': handle('moderation:history', async ({ userId }) => {
      await requireModerator();
      return backend.actionsAbout(userId);
    }),
    'moderation:decide': handle('moderation:decide', async (decision) => {
      await requireModerator();
      await backend.decide(decision);
      return null;
    }),
    'moderation:searchMembers': handle('moderation:searchMembers', async ({ query }) => {
      await requireModerator();
      return backend.searchMembers(query);
    }),
    'moderation:grantBadge': handle('moderation:grantBadge', async ({ userId, badge, reason }) => {
      await requireModerator();
      await requireOtherMember(userId);
      await backend.grantBadge(userId, badge, reason);
      return null;
    }),
    'moderation:revokeBadge': handle('moderation:revokeBadge', async ({ userId, badge, reason }) => {
      await requireModerator();
      await requireOtherMember(userId);
      await backend.revokeBadge(userId, badge, reason);
      return null;
    }),
  };
}
