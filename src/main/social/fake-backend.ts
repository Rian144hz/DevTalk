// In-memory community server for e2e tests and offline UI work (DEVTALK_FAKE_SOCIAL, never in packaged builds).
// It mirrors the database rules in supabase/migrations closely enough for the app to behave the same way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from '../../core/social/types';
import type { ModerationReport, ProfileDraft, ReportInput, SocialProfile } from '../../core/social/types';
import type { ModerationHistoryItem, Notice, SocialBackend, SocialSession } from './backend';
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
  action: 'warn' | 'suspend' | 'unsuspend';
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
});

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
  const toProfile = (p: Omit<SocialProfile, 'hasAvatar' | 'hasBanner'>): SocialProfile => ({ ...p, hasAvatar: p.id in state.avatars, hasBanner: false });
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
            reported: r.reported ? { id: r.reported, displayName: p?.displayName ?? 'Deleted account' } : null,
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
