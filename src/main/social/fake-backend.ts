// In-memory community server for e2e tests and offline UI work (DEVTALK_FAKE_SOCIAL, never in packaged builds).
// It mirrors the database rules in supabase/migrations closely enough for the app to behave the same way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { addDays, streaks, type DayActivity } from '../../core/progress/practice';
import { BADGE_LABELS, type ManualBadge } from '../../core/social/badges';
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from '../../core/social/types';
import type { Badge, ModerationReport, ProfileDraft, ReportInput, SocialProfile } from '../../core/social/types';
import type { MemberSummary, ModerationHistoryItem, Notice, PracticeGraphData, SocialBackend, SocialSession } from './backend';
import { SocialError } from './errors';
import type { SocialErrorKind } from './errors';

export const FAKE_CODE = '123456';
const DAY_MS = 86_400_000;
const REQUIRED = [...LEGAL_DOCUMENTS, 'age_18'];

interface StoredReport {
  id: number;
  reporter: string | null;
  reported: string | null;
  contextType: ReportInput['contextType'];
  contextId: string | null;
  reason: ReportInput['reason'];
  details: string;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: string;
}

interface StoredAction {
  target: string;
  action: 'warn' | 'suspend' | 'unsuspend' | 'grant_badge' | 'revoke_badge';
  reason: string;
  until: string | null;
  createdAt: string;
}

interface State {
  users: { id: string; email: string }[];
  session: SocialSession | null;
  consents: { userId: string; document: string; version: string; acceptedAt: string }[];
  profiles: Record<string, Omit<SocialProfile, 'hasAvatar' | 'hasBanner'>>;
  avatars: Record<string, string>; // base64 WebP
  blocks: { blocker: string; blocked: string }[];
  reports: StoredReport[];
  moderators: string[];
  actions: StoredAction[];
  notices: { id: number; userId: string; message: string; createdAt: string; readAt: string | null }[];
  nextId: number;
  seeded: string[];
  createdAt: Record<string, string>;
  usesLinux: Record<string, boolean>;
  banners: Record<string, { ext: 'gif' | 'webp'; data: string }>;
  practiceDays: Record<string, DayActivity[]>;
  milestones: { userId: string; kind: 'level_up' | 'vocabulary'; value: string; at: string }[];
  badgeGrants: { userId: string; badge: string }[];
}

export interface FakeSocialOptions {
  seed?: 'moderation';
  /** Persist the state here so a relaunch keeps it (e2e restarts). */
  filePath?: string;
  /** Make one call fail with the given kind (e2e error paths). */
  fail?: Partial<Record<keyof SocialBackend, SocialErrorKind>>;
  now?: () => number;
}

export interface FakeSocialBackend extends SocialBackend {
  seededUserIds(): string[];
  noticesFor(userId: string): Notice[];
  suspendForTest(userId: string, until: string): void;
  addNoticeForTest(userId: string, message: string): void;
}

const emptyState = (): State => ({
  users: [],
  session: null,
  consents: [],
  profiles: {},
  avatars: {},
  blocks: [],
  reports: [],
  moderators: [],
  actions: [],
  notices: [],
  nextId: 1,
  seeded: [],
  createdAt: {},
  usesLinux: {},
  banners: {},
  practiceDays: {},
  milestones: [],
  badgeGrants: [],
});

const LEVEL_ORDER = ['A2', 'B1', 'B2', 'C1', 'C2'];
const FOUNDING_CUTOFF = Date.parse('2027-01-01T03:00:00Z'); // 2027-01-01 00:00 in São Paulo
const AREA_LABEL: Record<string, string> = { backend: 'Back end', frontend: 'Front end', mobile: 'Mobile', data: 'Data', devops: 'DevOps' };
const validMilestone = (kind: string, value: string) =>
  kind === 'vocabulary'
    ? value === '50' || value === '100'
    : /^(A2|B1|B2|C1|C2)>(A2|B1|B2|C1|C2)$/.test(value) &&
      LEVEL_ORDER.indexOf(value.split('>')[0]!) < LEVEL_ORDER.indexOf(value.split('>')[1]!);

const SEED_PROFILE: Omit<SocialProfile, 'id' | 'displayName' | 'hasAvatar' | 'suspendedUntil' | 'hasBanner'> = {
  nativeLanguage: 'Portuguese (Brazil)',
  level: 'B1',
  timezone: 'America/Sao_Paulo',
  area: 'backend',
  stack: ['python', 'java'],
  availability: [{ day: 2, from: '19:00', to: '21:00' }],
  bio: '',
  mainStack: ['python'],
  showProgress: true,
  mascot: null,
};

export function createFakeSocialBackend(opts: FakeSocialOptions = {}): FakeSocialBackend {
  const now = opts.now ?? Date.now;
  const iso = (ms = now()) => new Date(ms).toISOString();
  let state: State = emptyState();
  if (opts.filePath && existsSync(opts.filePath)) {
    state = { ...emptyState(), ...(JSON.parse(readFileSync(opts.filePath, 'utf8')) as Partial<State>) };
  }
  const save = () => {
    if (opts.filePath) writeFileSync(opts.filePath, JSON.stringify(state));
  };
  const nextId = () => state.nextId++;
  const newUuid = () => `00000000-0000-4000-8000-${String(nextId()).padStart(12, '0')}`;

  const userByEmail = (email: string) => state.users.find((u) => u.email === email.toLowerCase());
  const createUser = (email: string) => {
    const user = { id: newUuid(), email: email.toLowerCase() };
    state.users.push(user);
    return user;
  };
  const acceptFor = (userId: string) => {
    for (const document of REQUIRED) {
      if (!state.consents.some((c) => c.userId === userId && c.document === document && c.version === LEGAL_VERSION)) {
        state.consents.push({ userId, document, version: LEGAL_VERSION, acceptedAt: iso() });
      }
    }
  };
  const putProfile = (id: string, displayName: string) => {
    state.profiles[id] = { id, displayName, ...SEED_PROFILE, suspendedUntil: null };
    state.createdAt[id] = iso();
  };
  const localToday = (timeZone: string) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(now()));
    } catch {
      return new Date(now()).toISOString().slice(0, 10);
    }
  };

  if (opts.seed === 'moderation' && state.users.length === 0) {
    const mod = createUser('mod@example.com');
    acceptFor(mod.id);
    putProfile(mod.id, 'Mod');
    state.moderators.push(mod.id);
    const sam = createUser('sam@example.com');
    acceptFor(sam.id);
    putProfile(sam.id, 'Sam');
    state.avatars[sam.id] = Buffer.from('RIFF-fake-webp').toString('base64');
    const alex = createUser('alex@example.com');
    acceptFor(alex.id);
    putProfile(alex.id, 'Alex');
    const kim = createUser('kim@example.com');
    acceptFor(kim.id);
    putProfile(kim.id, 'Kim');
    const base = { reporter: kim.id, contextType: 'profile' as const, contextId: null, status: 'open' as const };
    state.reports.push(
      { ...base, id: nextId(), reported: sam.id, reason: 'spam', details: 'Sends the same link to everyone.', createdAt: iso(now() - 2 * 3_600_000) },
      { ...base, id: nextId(), reported: alex.id, reason: 'harassment', details: 'Rude messages after I said no.', createdAt: iso(now() - 3_600_000) },
    );
    state.seeded = [sam.id, alex.id];
    state.badgeGrants.push({ userId: sam.id, badge: 'mentor' });
    const today = localToday(SEED_PROFILE.timezone);
    state.practiceDays[mod.id] = Array.from({ length: 10 }, (_, i) => ({ day: addDays(today, i - 9), answers: 1 + (i % 3), reviews: 4 * i }));
    state.session = { userId: mod.id, email: mod.email };
    save();
  }

  const failIf = (name: keyof SocialBackend) => {
    const kind = opts.fail?.[name];
    if (kind) throw new SocialError(kind, `Injected failure: ${kind}`);
  };
  const me = (): SocialSession => {
    if (!state.session) throw new SocialError('not_signed_in', 'Sign in first.');
    return state.session;
  };
  const suspendedUntil = (userId: string): string | null => {
    const until = state.profiles[userId]?.suspendedUntil ?? null;
    if (!until) return null;
    return until === 'infinity' || Date.parse(until) > now() ? until : null;
  };
  const isActive = (userId: string) => suspendedUntil(userId) === null;
  const isModerator = (userId: string) => state.moderators.includes(userId);
  const blockedBetween = (a: string, b: string) =>
    state.blocks.some((k) => (k.blocker === a && k.blocked === b) || (k.blocker === b && k.blocked === a));
  const assertActive = (userId: string) => {
    const until = suspendedUntil(userId);
    if (until) throw new SocialError('suspended', `Suspended until ${until}`, until);
  };
  /** Mirrors viewer_is_member(): active and the documents accepted. */
  const assertMember = (userId: string) => {
    if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the community rules first.');
    assertActive(userId);
  };
  const assertModerator = () => {
    if (!isModerator(me().userId)) throw new SocialError('forbidden', 'Only moderators can do this.');
  };
  const hasAccepted = (userId: string) =>
    REQUIRED.every((d) => state.consents.some((c) => c.userId === userId && c.document === d && c.version === LEGAL_VERSION));
  const toProfile = (p: Omit<SocialProfile, 'hasAvatar' | 'hasBanner'>): SocialProfile => ({
    ...p,
    hasAvatar: p.id in state.avatars,
    hasBanner: p.id in state.banners,
  });
  /** Mirrors can_see_profile (moderators see everyone). */
  const canSee = (viewer: string, target: string) =>
    viewer === target ||
    isModerator(viewer) ||
    (isActive(viewer) && hasAccepted(viewer) && isActive(target) && !blockedBetween(viewer, target) && target in state.profiles);
  /** Mirrors can_see_progress. */
  const canSeeProgress = (viewer: string, target: string) =>
    viewer === target ||
    (isActive(viewer) && hasAccepted(viewer) && isActive(target) && !blockedBetween(viewer, target) && !!state.profiles[target]?.showProgress);
  const streakOf = (target: string) => {
    const tz = state.profiles[target]?.timezone ?? 'UTC';
    return streaks(state.practiceDays[target] ?? [], localToday(tz));
  };
  const noticesFor = (userId: string): Notice[] =>
    state.notices
      .filter((n) => n.userId === userId)
      .map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt, read: n.readAt !== null }));

  const backend: FakeSocialBackend = {
    configured: true,

    async sendCode(email) {
      failIf('sendCode');
    },

    async verifyCode(email, code) {
      failIf('verifyCode');
      if (code !== FAKE_CODE) throw new SocialError('invalid_code', 'Token has expired or is invalid');
      const user = userByEmail(email) ?? createUser(email);
      state.session = { userId: user.id, email: user.email };
      save();
      return state.session;
    },

    async session() {
      return state.session;
    },

    async signOut() {
      failIf('signOut');
      state.session = null;
      save();
    },

    async hasAcceptedCurrentDocuments() {
      return hasAccepted(me().userId);
    },

    async acceptDocuments() {
      failIf('acceptDocuments');
      acceptFor(me().userId);
      save();
    },

    async getOwnProfile() {
      failIf('getOwnProfile');
      const p = state.profiles[me().userId];
      return p ? toProfile(p) : null;
    },

    async saveProfile(draft: ProfileDraft) {
      failIf('saveProfile');
      const { userId } = me();
      if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the documents first.');
      assertActive(userId);
      state.profiles[userId] = { ...draft, id: userId, suspendedUntil: state.profiles[userId]?.suspendedUntil ?? null };
      state.createdAt[userId] ??= iso();
      save();
      return toProfile(state.profiles[userId]);
    },

    async uploadAvatar(webp) {
      failIf('uploadAvatar');
      const { userId } = me();
      assertActive(userId);
      state.avatars[userId] = Buffer.from(webp).toString('base64');
      save();
    },

    async removeAvatar() {
      delete state.avatars[me().userId];
      save();
    },

    async avatarDataUrl(userId) {
      const viewer = me().userId;
      const data = state.avatars[userId];
      if (!data) return null;
      const member = isActive(viewer) && hasAccepted(viewer);
      const visible =
        userId === viewer || (member && (isModerator(viewer) || (isActive(userId) && !blockedBetween(viewer, userId))));
      return visible ? `data:image/webp;base64,${data}` : null;
    },

    async block(userId) {
      const { userId: blocker } = me();
      if (userId === blocker) throw new SocialError('forbidden', 'You cannot block yourself.');
      assertMember(blocker);
      if (!state.blocks.some((k) => k.blocker === blocker && k.blocked === userId)) state.blocks.push({ blocker, blocked: userId });
      save();
    },

    async unblock(userId) {
      const { userId: blocker } = me();
      state.blocks = state.blocks.filter((k) => !(k.blocker === blocker && k.blocked === userId));
      save();
    },

    async listBlocks() {
      const { userId } = me();
      return state.blocks.filter((k) => k.blocker === userId).map((k) => k.blocked);
    },

    async report(input) {
      failIf('report');
      const { userId } = me();
      if (input.reported === userId) throw new SocialError('forbidden', 'You cannot report yourself.');
      if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the community rules first.');
      assertActive(userId);
      const recent = state.reports.filter((r) => r.reporter === userId && Date.parse(r.createdAt) > now() - DAY_MS);
      if (recent.length >= 20) throw new SocialError('rate_limited', 'report limit reached');
      state.reports.push({ ...input, id: nextId(), reporter: userId, status: 'open', createdAt: iso() });
      save();
    },

    async listNotices() {
      return noticesFor(me().userId);
    },

    async markNoticeRead(id) {
      const { userId } = me();
      const n = state.notices.find((x) => x.id === id && x.userId === userId);
      if (n && !n.readAt) n.readAt = iso();
      save();
    },

    async isModerator() {
      return state.session ? isModerator(state.session.userId) : false;
    },

    async listOpenReports(): Promise<ModerationReport[]> {
      assertModerator();
      return state.reports
        .filter((r) => r.status === 'open')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => {
          const p = r.reported ? state.profiles[r.reported] : undefined;
          return {
            id: r.id,
            reporter: r.reporter ?? '',
            reported: r.reported
              ? { id: r.reported, displayName: p?.displayName ?? 'Deleted account', mascot: p?.mascot ?? null, hasAvatar: r.reported in state.avatars }
              : null,
            contextType: r.contextType,
            contextId: r.contextId,
            reason: r.reason,
            details: r.details,
            createdAt: r.createdAt,
          };
        });
    },

    async actionsAbout(userId): Promise<ModerationHistoryItem[]> {
      assertModerator();
      return state.actions
        .filter((a) => a.target === userId)
        .reverse()
        .map((a) => ({ action: a.action, reason: a.reason, until: a.until, createdAt: a.createdAt }));
    },

    async decide(decision) {
      failIf('decide');
      assertModerator();
      const close = (reportId: number | null, status: 'dismissed' | 'actioned') => {
        const r = state.reports.find((x) => x.id === reportId);
        if (r && r.status === 'open') r.status = status;
      };
      if (decision.kind === 'dismiss') {
        close(decision.reportId, 'dismissed');
      } else if (decision.kind === 'warn') {
        state.actions.push({ target: decision.target, action: 'warn', reason: decision.message, until: null, createdAt: iso() });
        state.notices.push({ id: nextId(), userId: decision.target, message: decision.message, createdAt: iso(), readAt: null });
        close(decision.reportId, 'actioned');
      } else if (decision.kind === 'suspend') {
        const until = decision.days === null ? 'infinity' : iso(now() + decision.days * DAY_MS);
        state.actions.push({ target: decision.target, action: 'suspend', reason: decision.reason, until, createdAt: iso() });
        const p = state.profiles[decision.target];
        if (p) p.suspendedUntil = until;
        close(decision.reportId, 'actioned');
      } else {
        state.actions.push({ target: decision.target, action: 'unsuspend', reason: '', until: null, createdAt: iso() });
        const p = state.profiles[decision.target];
        if (p) p.suspendedUntil = null;
      }
      save();
    },

    async exportOwnData() {
      failIf('exportOwnData');
      const { userId, email } = me();
      const p = state.profiles[userId];
      return {
        exportedAt: iso(),
        account: { email },
        profile: p ? toProfile(p) : null,
        consents: state.consents.filter((c) => c.userId === userId).map(({ userId: _u, ...c }) => c),
        blocks: state.blocks.filter((k) => k.blocker === userId).map((k) => ({ blocked: k.blocked })),
        reportsMade: state.reports.filter((r) => r.reporter === userId).map(({ reporter: _r, ...r }) => r),
        notices: noticesFor(userId),
        moderationActions: state.actions
          .filter((a) => a.target === userId)
          .reverse()
          .map((a) => ({ action: a.action, reason: a.reason, until: a.until, created_at: a.createdAt })),
        avatarUrl: userId in state.avatars ? 'fake://avatars/avatar.webp' : null,
      };
    },

    async deleteAccount() {
      failIf('deleteAccount');
      const { userId } = me();
      state.users = state.users.filter((u) => u.id !== userId);
      state.consents = state.consents.filter((c) => c.userId !== userId);
      delete state.profiles[userId];
      delete state.avatars[userId];
      delete state.banners[userId];
      delete state.practiceDays[userId];
      state.milestones = state.milestones.filter((m) => m.userId !== userId);
      state.badgeGrants = state.badgeGrants.filter((g) => g.userId !== userId);
      state.blocks = state.blocks.filter((k) => k.blocker !== userId && k.blocked !== userId);
      state.moderators = state.moderators.filter((m) => m !== userId);
      state.notices = state.notices.filter((n) => n.userId !== userId);
      for (const r of state.reports) {
        if (r.reporter === userId) r.reporter = null;
        if (r.reported === userId) r.reported = null;
      }
      state.session = null;
      save();
    },

    async badges(userId): Promise<Badge[]> {
      failIf('badges');
      const viewer = me().userId;
      const p = state.profiles[userId];
      if (!p || !canSee(viewer, userId)) return [];
      const out: Badge[] = [];
      const add = (id: string, group: Badge['group'], label = BADGE_LABELS[id] ?? id, detail: string | null = null) =>
        out.push({ id, group, label, detail });
      if (state.badgeGrants.some((g) => g.userId === userId && g.badge === 'creator')) add('creator', 'community');
      if (isModerator(userId)) add('moderator', 'community');
      if (Date.parse(state.createdAt[userId] ?? iso()) < FOUNDING_CUTOFF) add('founding_member', 'community');
      for (const b of ['beta_tester', 'mentor', 'open_source']) {
        if (state.badgeGrants.some((g) => g.userId === userId && g.badge === b)) add(b, 'community');
      }
      if (p.area !== 'other') add(`area:${p.area}`, 'technical', AREA_LABEL[p.area]!);
      if (state.usesLinux[userId]) add('linux', 'technical');
      for (const t of p.mainStack) add(`lang:${t}`, 'language', t);
      if (viewer === userId || p.showProgress) {
        const { current } = streakOf(userId);
        if (current >= 30) add('streak_30', 'evolution', BADGE_LABELS['streak_30'], String(current));
        else if (current >= 7) add('streak_7', 'evolution', BADGE_LABELS['streak_7'], String(current));
        const levels = state.milestones.filter((m) => m.userId === userId && m.kind === 'level_up');
        const last = levels[levels.length - 1];
        if (last) add('level_up', 'evolution', last.value.replace('>', ' → '), last.value);
        const tiers = state.milestones.filter((m) => m.userId === userId && m.kind === 'vocabulary').map((m) => Number(m.value));
        if (tiers.length) add('vocabulary', 'evolution', BADGE_LABELS['vocabulary'], `${Math.max(...tiers)}+`);
      }
      return out;
    },

    async practiceGraph(userId): Promise<PracticeGraphData> {
      failIf('practiceGraph');
      if (!canSeeProgress(me().userId, userId)) return { days: [], current: 0, longest: 0 };
      return { days: [...(state.practiceDays[userId] ?? [])], ...streakOf(userId) };
    },

    async publishPracticeDays(days) {
      failIf('publishPracticeDays');
      const { userId } = me();
      assertMember(userId);
      const byDay = new Map((state.practiceDays[userId] ?? []).map((d) => [d.day, d]));
      for (const d of days) byDay.set(d.day, { ...d });
      state.practiceDays[userId] = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
      save();
    },

    async publishMilestone(kind, value) {
      failIf('publishMilestone');
      const { userId } = me();
      assertMember(userId);
      if (!validMilestone(kind, value)) throw new SocialError('unknown', 'This milestone value is not allowed.');
      if (!state.milestones.some((m) => m.userId === userId && m.kind === kind && m.value === value)) {
        state.milestones.push({ userId, kind, value, at: iso() });
      }
      save();
    },

    async setUsesLinux(on) {
      const { userId } = me();
      state.usesLinux[userId] = on;
      save();
    },

    async uploadBanner(bytes, ext) {
      failIf('uploadBanner');
      const { userId } = me();
      assertMember(userId);
      state.banners[userId] = { ext, data: Buffer.from(bytes).toString('base64') };
      save();
    },

    async removeBanner() {
      delete state.banners[me().userId];
      save();
    },

    async bannerDataUrl(userId) {
      const viewer = me().userId;
      const banner = state.banners[userId];
      if (!banner || !canSee(viewer, userId)) return null;
      return `data:image/${banner.ext};base64,${banner.data}`;
    },

    async searchMembers(query): Promise<MemberSummary[]> {
      assertModerator();
      const q = query.trim().toLowerCase();
      return Object.values(state.profiles)
        .filter((p) => p.displayName.toLowerCase().includes(q))
        .slice(0, 20)
        .map((p) => ({ id: p.id, displayName: p.displayName, hasAvatar: p.id in state.avatars, mascot: p.mascot }));
    },

    async grantBadge(userId, badge: ManualBadge, reason) {
      failIf('grantBadge');
      assertModerator();
      const mod = me().userId;
      if (userId === mod || !isActive(mod)) throw new SocialError('forbidden', 'Moderators cannot change their own badges.');
      state.actions.push({ target: userId, action: 'grant_badge', reason, until: null, createdAt: iso() });
      if (!state.badgeGrants.some((g) => g.userId === userId && g.badge === badge)) state.badgeGrants.push({ userId, badge });
      state.notices.push({ id: nextId(), userId, message: `You received the ${BADGE_LABELS[badge]} badge.`, createdAt: iso(), readAt: null });
      save();
    },

    async revokeBadge(userId, badge: ManualBadge, reason) {
      failIf('revokeBadge');
      assertModerator();
      const mod = me().userId;
      if (userId === mod || !isActive(mod)) throw new SocialError('forbidden', 'Moderators cannot change their own badges.');
      state.actions.push({ target: userId, action: 'revoke_badge', reason, until: null, createdAt: iso() });
      state.badgeGrants = state.badgeGrants.filter((g) => !(g.userId === userId && g.badge === badge));
      save();
    },

    seededUserIds: () => [...state.seeded],
    noticesFor,
    suspendForTest(userId, until) {
      const p = state.profiles[userId];
      if (p) p.suspendedUntil = until;
      save();
    },
    addNoticeForTest(userId, message) {
      state.notices.push({ id: nextId(), userId, message, createdAt: iso(), readAt: null });
      save();
    },
  };
  return backend;
}
