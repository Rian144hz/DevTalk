import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  StorageApiError,
  createClient,
  isAuthApiError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js';
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from '../../core/social/types';
import type { DayActivity } from '../../core/progress/practice';
import { CHAT_PAGE, chatText } from '../../core/social/chat';
import type { ChatEvent, ChatMessage, ConversationStatus, ConversationSummary, ReportedMessage } from '../../core/social/chat';
import type { ManualBadge } from '../../core/social/badges';
import type { Badge, BadgeGroup, MascotId, MemberRow, NoticeActor, NoticeKind } from '../../core/social/types';
import type { AvailabilitySlot, ModerationReport, ProfileDraft, SocialProfile } from '../../core/social/types';
import type { Level } from '../../core/domain/types';
import type { Area, ReportContext, ReportReason } from '../../core/social/types';
import type { MemberSummary, ModerationHistoryItem, Notice, PracticeGraphData, SocialBackend, SocialSession } from './backend';
import { SocialError, mapSupabaseError } from './errors';
import type { SessionStore } from './session-store';

const DAY_MS = 86_400_000;
const REQUIRED = [...LEGAL_DOCUMENTS, 'age_18'] as const;
const avatarPath = (userId: string) => `${userId}/avatar.webp`;

/** suspended_until is not a readable column (see 0001_profiles.sql): always name the columns. */
const PROFILE_COLUMNS =
  'id, display_name, native_language, level, timezone, area, stack, availability, bio, avatar_path, main_stack, show_progress, mascot, banner_path, uses_linux, listed';
const GRAPH_DAYS = 371;

interface ProfileRow {
  id: string;
  display_name: string;
  native_language: string;
  level: string;
  timezone: string;
  area: string;
  stack: string[];
  availability: AvailabilitySlot[];
  bio: string;
  avatar_path: string | null;
  main_stack: string[] | null;
  show_progress: boolean | null;
  mascot: string | null;
  banner_path: string | null;
  uses_linux?: boolean | null;
  listed?: boolean | null;
}

function toProfile(row: ProfileRow, suspendedUntil: string | null): SocialProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    nativeLanguage: row.native_language,
    level: row.level as Level,
    timezone: row.timezone,
    area: row.area as Area,
    stack: row.stack ?? [],
    availability: row.availability ?? [],
    bio: row.bio ?? '',
    hasAvatar: row.avatar_path !== null,
    suspendedUntil,
    mainStack: row.main_stack ?? [],
    showProgress: row.show_progress ?? true,
    mascot: (row.mascot as MascotId | null) ?? null,
    hasBanner: row.banner_path !== null && row.banner_path !== undefined,
    listed: row.listed ?? true,
  };
}

interface MemberRowDb {
  id: string;
  display_name: string;
  level: string;
  area: string;
  main_stack: string[] | null;
  mascot: string | null;
  has_avatar: boolean;
}

function toMemberRow(r: MemberRowDb): MemberRow {
  return {
    id: r.id,
    displayName: r.display_name,
    level: r.level as Level,
    area: r.area as Area,
    mainStack: r.main_stack ?? [],
    mascot: (r.mascot as MascotId | null) ?? null,
    hasAvatar: r.has_avatar,
  };
}

function activeSuspension(until: string | null): string | null {
  if (!until) return null;
  return until === 'infinity' || Date.parse(until) > Date.now() ? until : null;
}

function mapAuthError(err: unknown, verifying = false): SocialError {
  if (isAuthRetryableFetchError(err)) {
    return new SocialError(err.status === 0 ? 'offline' : 'asleep', err.message);
  }
  if (isAuthApiError(err)) {
    const code = err.code ?? '';
    if (err.status === 429 || code.startsWith('over_')) return new SocialError('rate_limited', err.message);
    if (err.status >= 500) return new SocialError('asleep', err.message);
    if (verifying && (code === 'otp_expired' || code === 'invalid_credentials' || (err.status >= 400 && err.status < 500))) {
      return new SocialError('invalid_code', err.message);
    }
    return new SocialError('unknown', err.message);
  }
  if (err instanceof SocialError) return err;
  if (err instanceof TypeError) return new SocialError('offline', err.message);
  return new SocialError('unknown', err instanceof Error ? err.message : String(err));
}

function mapStorageError(err: unknown): SocialError {
  if (err instanceof StorageApiError) {
    const status = Number(err.status);
    return mapSupabaseError({ message: err.message }, Number.isFinite(status) ? status : 500);
  }
  return new SocialError('offline', err instanceof Error ? err.message : String(err));
}

interface ChangePayload {
  table: string;
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

/** The part of a Realtime channel the chat uses (tests pass their own). */
export interface ChatChannel {
  on(type: 'postgres_changes', filter: { event: '*'; schema: 'public'; table: string }, cb: (payload: ChangePayload) => void): ChatChannel;
  subscribe(cb: (status: string) => void): unknown;
  unsubscribe(): unknown;
}

const CHAT_TABLES = ['conversations', 'messages', 'corrections'] as const;
const MESSAGE_COLUMNS = 'id, conversation_id, sender, body, created_at, deleted_at, corrections(id, message_id, author, corrected, created_at, thanked_at)';

interface CorrectionRowDb {
  id: number;
  message_id: number;
  author: string;
  corrected: string;
  created_at: string;
  thanked_at: string | null;
}

interface MessageRowDb {
  id: number;
  conversation_id: string;
  sender: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  corrections: CorrectionRowDb[] | null;
}

function toChatMessage(r: MessageRowDb): ChatMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender,
    body: r.body,
    createdAt: r.created_at,
    deleted: r.deleted_at !== null,
    corrections: (r.corrections ?? [])
      .map((k) => ({ id: k.id, messageId: k.message_id, authorId: k.author, corrected: k.corrected, createdAt: k.created_at, thanked: k.thanked_at !== null }))
      .sort((a, b) => a.id - b.id),
  };
}

/** The trimmed text, or a SocialError before anything is sent. */
function validText(raw: string): string {
  const text = chatText(raw);
  if (text === null) throw new SocialError('unknown', 'Write 1 to 2000 characters.');
  return text;
}

export interface SupabaseBackendOptions {
  url: string;
  key: string;
  storage: SessionStore;
  fetch?: typeof fetch;
  autoRefreshToken?: boolean;
  /** Opens a Realtime channel; defaults to the client's own (tests replace it). */
  openChannel?: (name: string) => ChatChannel;
}

export function createSupabaseBackend(opts: SupabaseBackendOptions): SocialBackend {
  const client = createClient(opts.url, opts.key, {
    auth: {
      storage: opts.storage,
      persistSession: true,
      autoRefreshToken: opts.autoRefreshToken ?? true,
      detectSessionInUrl: false,
    },
    global: opts.fetch ? { fetch: opts.fetch } : {},
  });

  /** Unwraps a PostgREST result or throws the mapped error. */
  function check<T>(res: { data: T; error: { code?: string; message?: string } | null; status: number }): T {
    if (res.error) throw mapSupabaseError(res.error, res.status);
    return res.data;
  }

  async function me(): Promise<SocialSession> {
    const s = await session();
    if (!s) throw new SocialError('not_signed_in', 'Sign in first.');
    return s;
  }

  async function session(): Promise<SocialSession | null> {
    const { data, error } = await client.auth.getSession();
    if (error) throw mapAuthError(error);
    const user = data.session?.user;
    return user ? { userId: user.id, email: user.email ?? '' } : null;
  }

  async function ownRow(userId: string): Promise<ProfileRow | null> {
    return check(await client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle<ProfileRow>());
  }

  /** The caller's suspension end while it lasts, else null. */
  async function mySuspension(): Promise<string | null> {
    return activeSuspension((check(await client.rpc('my_suspension')) as string | null) ?? null);
  }

  async function assertActive(): Promise<void> {
    const until = await mySuspension();
    if (until) throw new SocialError('suspended', `Suspended until ${until}`, until);
  }

  const openChannel = opts.openChannel ?? ((name: string) => client.channel(name) as unknown as ChatChannel);
  const liveStops = new Set<() => void>();
  let channelCount = 0;

  /** The conversation a Realtime row belongs to; null when the event carries no way to tell (a deleted correction). */
  async function eventOf(p: ChangePayload): Promise<ChatEvent | null> {
    const row = Object.keys(p.new ?? {}).length > 0 ? p.new : p.old ?? {};
    if (p.table === 'conversations') return typeof row['id'] === 'string' ? { kind: 'conversation', conversationId: row['id'] } : null;
    if (p.table === 'messages') {
      return typeof row['conversation_id'] === 'string' ? { kind: 'message', conversationId: row['conversation_id'] } : null;
    }
    if (p.table === 'corrections' && typeof row['message_id'] === 'number') {
      const m = check(await client.from('messages').select('conversation_id').eq('id', row['message_id']).maybeSingle()) as {
        conversation_id: string;
      } | null;
      return m ? { kind: 'correction', conversationId: m.conversation_id } : null;
    }
    return null;
  }

  /** Signing out never needs the network: forget the stored session first, then tell the client. */
  async function forgetSession(): Promise<void> {
    for (const stop of [...liveStops]) stop();
    opts.storage.clear();
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }

  return {
    configured: true,

    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw mapAuthError(error);
    },

    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw mapAuthError(error, true);
      if (!data.user) throw new SocialError('invalid_code', 'No user returned for this code.');
      return { userId: data.user.id, email: data.user.email ?? email };
    },

    session,

    async signOut() {
      await forgetSession();
    },

    async hasAcceptedCurrentDocuments() {
      const { userId } = await me();
      const rows = check(
        await client.from('consents').select('document').eq('user_id', userId).eq('version', LEGAL_VERSION),
      ) as { document: string }[];
      const have = new Set(rows.map((r) => r.document));
      return REQUIRED.every((d) => have.has(d));
    },

    async acceptDocuments() {
      const { userId } = await me();
      const rows = REQUIRED.map((document) => ({ user_id: userId, document, version: LEGAL_VERSION }));
      check(await client.from('consents').upsert(rows, { onConflict: 'user_id,document,version', ignoreDuplicates: true }));
    },

    async getOwnProfile() {
      const { userId } = await me();
      const row = await ownRow(userId);
      return row ? toProfile(row, await mySuspension()) : null;
    },

    async saveProfile(draft: ProfileDraft) {
      const { userId } = await me();
      await assertActive();
      const row = {
        id: userId,
        display_name: draft.displayName,
        native_language: draft.nativeLanguage,
        level: draft.level,
        timezone: draft.timezone,
        area: draft.area,
        stack: draft.stack,
        availability: draft.availability,
        bio: draft.bio,
        main_stack: draft.mainStack,
        show_progress: draft.showProgress,
        mascot: draft.mascot,
        listed: draft.listed,
      };
      const saved = check(await client.from('profiles').upsert(row, { onConflict: 'id' }).select(PROFILE_COLUMNS).single<ProfileRow>());
      if (!saved) throw new SocialError('unknown', 'The profile was not saved.');
      return toProfile(saved, null);
    },

    async uploadAvatar(webp) {
      const { userId } = await me();
      const { error } = await client.storage
        .from('avatars')
        .upload(avatarPath(userId), webp, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
      if (error) throw mapStorageError(error);
      check(await client.from('profiles').update({ avatar_path: avatarPath(userId) }).eq('id', userId));
    },

    async removeAvatar() {
      const { userId } = await me();
      const { error } = await client.storage.from('avatars').remove([avatarPath(userId)]);
      if (error) throw mapStorageError(error);
      check(await client.from('profiles').update({ avatar_path: null }).eq('id', userId));
    },

    async avatarDataUrl(userId) {
      await me();
      const { data, error } = await client.storage.from('avatars').download(avatarPath(userId));
      if (error || !data) return null;
      const bytes = Buffer.from(await data.arrayBuffer());
      return `data:image/webp;base64,${bytes.toString('base64')}`;
    },

    async block(userId) {
      const { userId: blocker } = await me();
      check(await client.from('blocks').upsert({ blocker, blocked: userId }, { onConflict: 'blocker,blocked', ignoreDuplicates: true }));
    },

    async unblock(userId) {
      const { userId: blocker } = await me();
      check(await client.from('blocks').delete().eq('blocker', blocker).eq('blocked', userId));
    },

    async listBlocks() {
      await me();
      const rows = check(await client.from('blocks').select('blocked').order('created_at')) as { blocked: string }[];
      return rows.map((r) => r.blocked);
    },

    async report(input) {
      const { userId } = await me();
      await assertActive();
      check(
        await client.from('reports').insert({
          reporter: userId,
          reported: input.reported,
          context_type: input.contextType,
          context_id: input.contextId,
          reason: input.reason,
          details: input.details,
        }),
      );
    },

    async listNotices(): Promise<Notice[]> {
      await me();
      const rows = check(
        await client.from('notices').select('id, message, created_at, read_at, kind, actor').order('created_at', { ascending: false }),
      ) as { id: number; message: string; created_at: string; read_at: string | null; kind: NoticeKind | null; actor: string | null }[];
      const actorIds = [...new Set(rows.flatMap((r) => (r.actor ? [r.actor] : [])))];
      const actors = new Map<string, NoticeActor>();
      if (actorIds.length > 0) {
        const found = check(await client.from('profiles').select('id, display_name, avatar_path, mascot').in('id', actorIds)) as {
          id: string;
          display_name: string;
          avatar_path: string | null;
          mascot: string | null;
        }[];
        for (const f of found) {
          actors.set(f.id, { id: f.id, displayName: f.display_name, hasAvatar: f.avatar_path !== null, mascot: (f.mascot as MascotId | null) ?? null });
        }
      }
      return rows.map((r) => ({
        id: r.id,
        message: r.message,
        createdAt: r.created_at,
        read: r.read_at !== null,
        kind: r.kind ?? 'moderation',
        // A follower who is now blocked or gone keeps the notice text but no link.
        actor: (r.actor && actors.get(r.actor)) || null,
      }));
    },

    async markNoticeRead(id) {
      await me();
      check(await client.from('notices').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null));
    },

    async isModerator() {
      if (!(await session())) return false;
      return check(await client.rpc('is_moderator')) === true;
    },

    async listOpenReports(): Promise<ModerationReport[]> {
      await me();
      if (!(await this.isModerator())) throw new SocialError('forbidden', 'Only moderators can do this.');
      const rows = check(
        await client
          .from('reports')
          .select('id, reporter, reported, context_type, context_id, reason, details, created_at')
          .eq('status', 'open')
          .order('created_at'),
      ) as {
        id: number;
        reporter: string | null;
        reported: string | null;
        context_type: ReportContext;
        context_id: string | null;
        reason: ReportReason;
        details: string;
        created_at: string;
      }[];
      const ids = [...new Set(rows.map((r) => r.reported).filter((x): x is string => x !== null))];
      const people = new Map<string, { display_name: string; mascot: string | null; avatar_path: string | null }>();
      if (ids.length > 0) {
        const rows = check(await client.from('profiles').select('id, display_name, mascot, avatar_path').in('id', ids)) as {
          id: string;
          display_name: string;
          mascot: string | null;
          avatar_path: string | null;
        }[];
        for (const p of rows) people.set(p.id, p);
      }
      return rows.map((r) => ({
        id: r.id,
        reporter: r.reporter ?? '',
        reported: r.reported
          ? {
              id: r.reported,
              displayName: people.get(r.reported)?.display_name ?? 'Deleted account',
              mascot: (people.get(r.reported)?.mascot as MascotId | null) ?? null,
              hasAvatar: !!people.get(r.reported)?.avatar_path,
            }
          : null,
        contextType: r.context_type,
        contextId: r.context_id,
        reason: r.reason,
        details: r.details,
        createdAt: r.created_at,
      }));
    },

    async actionsAbout(userId): Promise<ModerationHistoryItem[]> {
      await me();
      const rows = check(
        await client
          .from('moderation_actions')
          .select('action, reason, until, badge, created_at')
          .eq('target', userId)
          .order('created_at', { ascending: false }),
      ) as { action: string; reason: string; until: string | null; badge: string | null; created_at: string }[];
      return rows.map((r) => ({ action: r.action, reason: r.reason, until: r.until, badge: r.badge, createdAt: r.created_at }));
    },

    async decide(decision) {
      await me();
      if (decision.kind === 'dismiss') {
        check(await client.from('reports').update({ status: 'dismissed' }).eq('id', decision.reportId).eq('status', 'open'));
        return;
      }
      const row: Record<string, string | number | null> =
        decision.kind === 'warn'
          ? { target: decision.target, action: 'warn', reason: decision.message, report_id: decision.reportId }
          : decision.kind === 'suspend'
            ? {
                target: decision.target,
                action: 'suspend',
                reason: decision.reason,
                until: decision.days === null ? 'infinity' : new Date(Date.now() + decision.days * DAY_MS).toISOString(),
                report_id: decision.reportId,
              }
            : { target: decision.target, action: 'unsuspend', reason: '' };
      check(await client.from('moderation_actions').insert(row));
    },

    async exportOwnData() {
      const { userId, email } = await me();
      const row = await ownRow(userId);
      const consents = check(await client.from('consents').select('document, version, accepted_at').eq('user_id', userId));
      const blocks = check(await client.from('blocks').select('blocked, created_at').eq('blocker', userId));
      const reportsMade = check(
        await client.from('reports').select('id, reported, context_type, context_id, reason, details, status, created_at').eq('reporter', userId),
      );
      const notices = await this.listNotices();
      const moderationActions = check(await client.rpc('my_moderation_actions'));
      let avatarUrl: string | null = null;
      if (row?.avatar_path) {
        const { data } = await client.storage.from('avatars').createSignedUrl(row.avatar_path, 3600);
        avatarUrl = data?.signedUrl ?? null;
      }
      let bannerUrl: string | null = null;
      if (row?.banner_path) {
        const { data } = await client.storage.from('banners').createSignedUrl(row.banner_path, 3600);
        bannerUrl = data?.signedUrl ?? null;
      }
      const progress = check(await client.rpc('my_progress_export'));
      const social = check(await client.rpc('my_social_export'));
      const chat = check(await client.rpc('my_chat_export'));
      const badges = await this.badges(userId);
      return {
        exportedAt: new Date().toISOString(),
        account: { email },
        profile: row ? toProfile(row, await mySuspension()) : null,
        consents,
        blocks,
        reportsMade,
        notices,
        moderationActions,
        avatarUrl,
        bannerUrl,
        usesLinux: row?.uses_linux ?? false,
        badges,
        progress,
        social,
        chat,
      };
    },

    async badges(userId): Promise<Badge[]> {
      await me();
      const rows = check(await client.rpc('profile_badges', { target: userId })) as
        | { id: string; grp: string; label: string; detail: string | null }[]
        | null;
      return (rows ?? []).map((r) => ({ id: r.id, group: r.grp as BadgeGroup, label: r.label, detail: r.detail }));
    },

    async practiceGraph(userId): Promise<PracticeGraphData> {
      await me();
      const since = new Date(Date.now() - GRAPH_DAYS * 86_400_000).toISOString().slice(0, 10);
      const days = check(
        await client.from('practice_days').select('day, answers, reviews, corrections').eq('user_id', userId).gte('day', since).order('day'),
      ) as DayActivity[];
      const streak = check(await client.rpc('practice_streaks', { target: userId })) as { current: number; longest: number }[] | null;
      return { days: days ?? [], current: streak?.[0]?.current ?? 0, longest: streak?.[0]?.longest ?? 0 };
    },

    async publishPracticeDays(days) {
      const { userId } = await me();
      if (days.length === 0) return;
      const rows = days.map((d) => ({ user_id: userId, day: d.day, answers: d.answers, reviews: d.reviews }));
      check(await client.from('practice_days').upsert(rows, { onConflict: 'user_id,day' }));
    },

    async publishMilestone(kind, value) {
      const { userId } = await me();
      check(
        await client
          .from('milestones')
          .upsert({ user_id: userId, kind, value }, { onConflict: 'user_id,kind,value', ignoreDuplicates: true }),
      );
    },

    async setUsesLinux(on) {
      const { userId } = await me();
      // Only when it changes: an update bumps profiles.updated_at, which members can read.
      check(await client.from('profiles').update({ uses_linux: on }).eq('id', userId).neq('uses_linux', on));
    },

    async uploadBanner(bytes, ext) {
      const { userId } = await me();
      const bucket = client.storage.from('banners');
      const path = `${userId}/banner.${ext}`;
      const { error } = await bucket.upload(path, bytes, { upsert: true, contentType: `image/${ext}`, cacheControl: '3600' });
      if (error) throw mapStorageError(error);
      await bucket.remove([`${userId}/banner.${ext === 'gif' ? 'webp' : 'gif'}`]);
      check(await client.from('profiles').update({ banner_path: path }).eq('id', userId));
    },

    async removeBanner() {
      const { userId } = await me();
      const { error } = await client.storage.from('banners').remove([`${userId}/banner.gif`, `${userId}/banner.webp`]);
      if (error) throw mapStorageError(error);
      check(await client.from('profiles').update({ banner_path: null }).eq('id', userId));
    },

    async bannerDataUrl(userId) {
      await me();
      const row = check(await client.from('profiles').select('banner_path').eq('id', userId).maybeSingle()) as {
        banner_path: string | null;
      } | null;
      if (!row?.banner_path) return null;
      const { data, error } = await client.storage.from('banners').download(row.banner_path);
      if (error || !data) return null;
      const mime = row.banner_path.endsWith('.gif') ? 'image/gif' : 'image/webp';
      return `data:${mime};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`;
    },

    async searchMembers(query): Promise<MemberSummary[]> {
      await me();
      if (!(await this.isModerator())) throw new SocialError('forbidden', 'Only moderators can do this.');
      const pattern = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = check(
        await client.from('profiles').select('id, display_name, avatar_path, mascot').ilike('display_name', pattern).order('display_name').limit(20),
      ) as { id: string; display_name: string; avatar_path: string | null; mascot: string | null }[];
      return rows.map((r) => ({ id: r.id, displayName: r.display_name, hasAvatar: !!r.avatar_path, mascot: (r.mascot as MascotId | null) ?? null }));
    },

    async grantBadge(userId, badge: ManualBadge, reason) {
      await me();
      check(await client.from('moderation_actions').insert({ target: userId, action: 'grant_badge', badge, reason }));
    },

    async revokeBadge(userId, badge: ManualBadge, reason) {
      await me();
      check(await client.from('moderation_actions').insert({ target: userId, action: 'revoke_badge', badge, reason }));
    },

    async members(filters, page) {
      await me();
      const blank = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
      const rows = check(
        await client.rpc('member_directory', {
          q: blank(filters.query),
          lvl: filters.level ?? null,
          area_filter: filters.area ?? null,
          stack_tag: blank(filters.stack),
          page,
        }),
      ) as MemberRowDb[];
      return rows.map(toMemberRow);
    },

    async profileOf(userId) {
      await me();
      const row = check(await client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()) as ProfileRow | null;
      // Others' suspensions are not readable; a suspended member is not visible anyway.
      return row ? toProfile(row, null) : null;
    },

    async socialStats(userId) {
      await me();
      const rows = check(await client.rpc('profile_social', { target: userId })) as
        | { followers: number; following: number; likes: number; i_follow: boolean; i_like: boolean }[]
        | null;
      const r = rows?.[0];
      return r
        ? { followers: r.followers, following: r.following, likes: r.likes, iFollow: r.i_follow, iLike: r.i_like }
        : { followers: 0, following: 0, likes: 0, iFollow: false, iLike: false };
    },

    async follow(userId) {
      const { userId: follower } = await me();
      check(await client.from('follows').upsert({ follower, followee: userId }, { onConflict: 'follower,followee', ignoreDuplicates: true }));
    },

    async unfollow(userId) {
      const { userId: follower } = await me();
      check(await client.from('follows').delete().eq('follower', follower).eq('followee', userId));
    },

    async like(userId) {
      const { userId: liker } = await me();
      check(await client.from('profile_likes').upsert({ liker, profile: userId }, { onConflict: 'liker,profile', ignoreDuplicates: true }));
    },

    async unlike(userId) {
      const { userId: liker } = await me();
      check(await client.from('profile_likes').delete().eq('liker', liker).eq('profile', userId));
    },

    async followers(userId, page) {
      await me();
      return (check(await client.rpc('followers_of', { target: userId, page })) as MemberRowDb[]).map(toMemberRow);
    },

    async following(userId, page) {
      await me();
      return (check(await client.rpc('following_of', { target: userId, page })) as MemberRowDb[]).map(toMemberRow);
    },

    async conversations(): Promise<ConversationSummary[]> {
      await me();
      const rows = check(await client.rpc('my_conversations')) as {
        id: string;
        other_id: string;
        other_name: string;
        other_has_avatar: boolean;
        other_mascot: string | null;
        status: ConversationStatus;
        requested_by_me: boolean;
        preview: string | null;
        last_message_at: string | null;
        unread: number;
      }[];
      return (rows ?? []).map((r) => ({
        id: r.id,
        other: { id: r.other_id, displayName: r.other_name, hasAvatar: r.other_has_avatar, mascot: (r.other_mascot as MascotId | null) ?? null },
        status: r.status,
        requestedByMe: r.requested_by_me,
        preview: r.preview,
        lastMessageAt: r.last_message_at,
        unread: r.unread,
      }));
    },

    async messages(conversationId, before) {
      await me();
      let q = client.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId);
      if (before !== null) q = q.lt('id', before);
      const rows = check(await q.order('id', { ascending: false }).limit(CHAT_PAGE)) as unknown as MessageRowDb[];
      return (rows ?? []).map(toChatMessage).reverse();
    },

    async requestConversation(userId, body) {
      const text = validText(body);
      await me();
      return check(await client.rpc('request_conversation', { target: userId, body: text })) as string;
    },

    async respondConversation(conversationId, accept) {
      await me();
      check(await client.rpc('respond_conversation', { conversation: conversationId, accept }));
    },

    async sendMessage(conversationId, body) {
      const text = validText(body);
      const { userId } = await me();
      check(await client.from('messages').insert({ conversation_id: conversationId, sender: userId, body: text }));
    },

    async deleteMessage(messageId) {
      await me();
      check(await client.rpc('delete_message', { message: messageId }));
    },

    async suggestCorrection(messageId, corrected) {
      const text = validText(corrected);
      const { userId } = await me();
      check(await client.from('corrections').insert({ message_id: messageId, author: userId, corrected: text }));
    },

    async thankCorrection(correctionId) {
      await me();
      check(await client.rpc('thank_correction', { correction: correctionId }));
    },

    async markRead(conversationId) {
      await me();
      check(await client.rpc('mark_read', { conversation: conversationId }));
    },

    async reportContext(reportId): Promise<ReportedMessage[]> {
      await me();
      const rows = check(await client.rpc('report_context', { report: reportId })) as {
        message_id: number;
        sender_name: string | null;
        body: string;
        created_at: string;
        reported: boolean;
      }[];
      return (rows ?? []).map((r) => ({ messageId: r.message_id, senderName: r.sender_name, body: r.body, createdAt: r.created_at, reported: r.reported }));
    },

    subscribe(onEvent, onStatus) {
      let open = true;
      const channel = openChannel(`chat-${++channelCount}`);
      const handle = (p: ChangePayload) => {
        if (!open) return;
        void eventOf(p).then(
          (e) => {
            if (open && e) onEvent(e);
          },
          () => undefined,
        );
      };
      for (const table of CHAT_TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table }, handle);
      channel.subscribe((status) => {
        if (open) onStatus(status === 'SUBSCRIBED');
      });
      const stop = () => {
        if (!open) return;
        open = false;
        liveStops.delete(stop);
        void Promise.resolve(channel.unsubscribe()).catch(() => undefined);
      };
      liveStops.add(stop);
      return stop;
    },

    async deleteAccount() {
      await me();
      const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const status = (error.context as Response | undefined)?.status ?? 500;
          if (status === 404) throw new SocialError('unknown', 'The delete-account function is not deployed.');
          if (status >= 500) throw new SocialError('asleep', 'The community server could not delete the account.');
          throw new SocialError('unknown', `Delete failed (HTTP ${status}).`);
        }
        if (error instanceof FunctionsRelayError) throw new SocialError('asleep', error.message);
        if (error instanceof FunctionsFetchError) throw new SocialError('offline', error.message);
        throw mapAuthError(error);
      }
      await forgetSession();
    },
  };
}
