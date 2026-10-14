# DevTalk Phase 2A (Social Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts (e-mail + code), consented sign-up with 18+, a public profile with optional photo and one-colour stack logos, block/report with an in-app moderation queue, and LGPD export/delete — on the user's Supabase project, with RLS proven offline.

**Architecture:** A `SocialBackend` port lives in the main process with two implementations: `SupabaseBackend` (supabase-js, session encrypted on the keyring) and `FakeSocialBackend` (e2e and dev). The renderer reaches it only through zod-validated `social:*` / `safety:*` / `moderation:*` IPC, so the window still has no network access. Postgres schema, RLS and storage policies live in `supabase/migrations/` and are tested against PGlite with a stub `auth`/`storage` schema. A single `supabase/setup.sql` (generated) is pasted in the dashboard; the `delete-account` Edge Function is pasted in the dashboard editor.

**Tech Stack:** existing (Electron 44, React 19, TS 6, vitest 5, Playwright 1.64, zod 4) plus `@supabase/supabase-js@2.117.3`, `@electric-sql/pglite@0.5.9` (dev), `simple-icons@16.35.0` (dev; build-time icon extraction).

**Spec:** `docs/superpowers/specs/2026-10-14-devtalk-phase2a-social-foundation-design.md` · Visual authority: `DESIGN.md` (Galley Proof) · Product: `PRODUCT.md`.

## Global Constraints

- Exact new versions above, `--save-exact`. `simple-icons` and `@electric-sql/pglite` are devDependencies.
- The Supabase client exists only in `src/main/social/`. The renderer CSP stays `connect-src 'self'; img-src 'self' data:`.
- Only `MAIN_VITE_SUPABASE_URL` and `MAIN_VITE_SUPABASE_PUBLISHABLE_KEY` reach the app (via `import.meta.env` in main). A key starting `sb_secret_` or a JWT with `role: service_role` makes the app refuse to start the social backend (`not_configured`). The service role key exists only inside the Edge Function.
- The session is stored with `safeStorage` (same keyring rules as the API keys) in `social-session.bin`; never in renderer storage.
- Every table has RLS enabled and explicit `GRANT`s to `authenticated`; nothing is granted to `anon`. Functions are `security definer` with `set search_path = public`.
- Legal document version string: `'2026-10-14'`. Documents: `terms`, `privacy`, `conduct`, plus the attestation `age_18`.
- Profile limits: display name 2–40, stack ≤ 10 tags of ≤ 30 chars, availability ≤ 14 slots, bio ≤ 160, reports ≤ 20 per reporter per rolling 24 h, report details ≤ 1000.
- Avatar: input JPEG/PNG/WebP ≤ 8 MB; output 256×256 WebP ≤ 200 KB at `avatars/{uid}/avatar.webp`; renderer re-encodes (drops EXIF).
- OTP input accepts 6–10 digits; "Send a new code" is disabled for 60 s after a send.
- `DEVTALK_FAKE_SOCIAL=1` selects the fake backend only when `!app.isPackaged`.
- UI copy plain English, sentence case; no kicker labels; logos and avatars in text tones only (DESIGN.md "Blue Pencil" and "Float-Only" rules); `ReportDialog` is the only new modal.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Blocked or suspended people leaking** — a blocked person's profile, avatar or reports must not be readable by the other side (both directions), and a suspended account must vanish from others' reads. Tests in Task 2/3.
2. **Self-escalation** — a user setting their own `suspended_until`, inserting into `moderators`, resolving reports or writing `moderation_actions`. Tests in Task 3.
3. **Abandoned sign-up** — quitting between code verification and profile creation leaves a session without consents/profile; the next start must resume at the documents step, never at People. Test in Task 7.
4. **Deleting the account while offline or with the function missing** — the app must say so and keep the local session, not sign out silently. Test in Task 9.
5. **Hostile avatar input** — a 30 MB file, an SVG, a GIF, a renamed text file — rejected with a clear message before upload. Test in Task 6.

---

### Task 1: Social domain types and validation (core)

**Files:** Create `src/core/social/types.ts`, `src/core/social/validate.ts` · Test `tests/core/social.test.ts`

**Interfaces — Produces:**
```ts
AREAS = ['backend','frontend','mobile','data','devops','other'] as const; type Area
REPORT_REASONS = ['harassment','hate','sexual','spam','impersonation','minor','other'] as const
REPORT_CONTEXTS = ['profile','message','room'] as const
type ReportReason = (typeof REPORT_REASONS)[number]; type ReportContext = (typeof REPORT_CONTEXTS)[number]   // Level comes from src/core/domain/types.ts
LEGAL_DOCUMENTS = ['terms','privacy','conduct'] as const; LEGAL_VERSION = '2026-10-14'
interface AvailabilitySlot { day: 0|1|2|3|4|5|6; from: string /* HH:MM */; to: string }
interface SocialProfile { id: string; displayName: string; nativeLanguage: string; level: Level; timezone: string; area: Area;
  stack: string[]; availability: AvailabilitySlot[]; bio: string; hasAvatar: boolean; suspendedUntil: string | null }
type ProfileDraft = Omit<SocialProfile, 'id' | 'hasAvatar' | 'suspendedUntil'>
ProfileDraftSchema: z.ZodType<ProfileDraft>   // all limits from Global Constraints; slot from < to; nativeLanguage 1–60 chars; IANA timezone non-empty
normalizeStackTags(tags: string[]): string[]   // trim, collapse spaces, lowercase, drop empties, dedupe, cap 10
interface ReportInput { reported: string; contextType: ReportContext; contextId: string | null; reason: ReportReason; details: string }
interface ModerationReport { id: number; reporter: string; reported: { id: string; displayName: string } | null; contextType; contextId; reason; details; createdAt: string }
type ModerationDecision = { kind: 'dismiss'; reportId: number } | { kind: 'warn'; reportId: number | null; target: string; message: string }
  | { kind: 'suspend'; reportId: number | null; target: string; days: 1 | 7 | 30 | null /* null = permanent */; reason: string } | { kind: 'unsuspend'; target: string }
```

- [ ] **Step 1: Failing tests** — `normalizeStackTags(['  Python','python ', 'React  Native', ''])` → `['python','react native']`; 11 tags → 10; draft with 41-char name, 11 slots, `from: '10:00', to: '09:00'`, 161-char bio each fail with the field path; a valid draft parses.
- [ ] **Step 2: Run** `npm run test:core` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(core): social domain types and profile validation`.

---

### Task 2: Schema, profiles and consents with RLS (PGlite harness)

**Files:** Create `supabase/migrations/0001_profiles.sql`, `tests/supabase/harness.ts`, `tests/supabase/stubs.sql`, `tests/supabase/profiles.test.ts` · Modify `vitest.config.ts` (project `supabase`: `tests/supabase/**/*.test.ts`, node), `package.json` (`test:supabase`; `test` runs it), install `@electric-sql/pglite@0.5.9 -D`

**Interfaces — Produces:**
```ts
// harness.ts
createDb(): Promise<{ db: PGlite; as(userId: string | null): Promise<void> /* null = anon */; asOwner(): Promise<void>;
  newUser(email?: string): Promise<string> /* inserts auth.users, returns uuid */ }>
```
`stubs.sql`: roles `anon`, `authenticated`, `service_role`; schema `auth` with `users(id uuid pk, email text)` and `auth.uid()` reading `current_setting('request.jwt.claim.sub', true)::uuid`; schema `storage` with `buckets`, `objects(bucket_id, name, owner)` and `storage.foldername(name)` like Supabase's.

Migration 0001: `profiles` (spec §4/§5 columns, checks for every limit, `level`/`area` checks, `updated_at` trigger, trigger blocking owner edits of `suspended_until`), `consents` (pk user/document/version, document check incl. `age_18`), `is_active(uid)`, RLS + policies per spec §5, GRANTs.

- [ ] **Step 1: Failing tests** (each as a named test): anon reads nothing; a user inserts and reads their own profile; another active user can read it; a user cannot update someone else's profile; the owner cannot change `suspended_until`; a suspended owner cannot update their profile; a suspended profile is invisible to others but visible to its owner; consents insert/select own only, no update/delete; deleting `auth.users` cascades the profile and consents; violating each check (name length, 11 tags, bad level) raises.
- [ ] **Step 2: Run** `npm run test:supabase` → FAIL. **Step 3: Write** stubs, harness and migration. **Step 4: Run** → PASS. **Step 5: Commit** `feat(supabase): profiles and consents with RLS, PGlite test harness`.

---

### Task 3: Safety, moderation and storage policies

**Files:** Create `supabase/migrations/0002_safety.sql`, `supabase/migrations/0003_storage.sql`, `tests/supabase/safety.test.ts`, `tests/supabase/storage.test.ts`, `scripts/build-setup-sql.mjs`, generated `supabase/setup.sql`

**Interfaces — Produces:** tables `blocks`, `reports` (`reporter`/`reported` `on delete set null`), `moderators`, `moderation_actions`, `notices`; functions `is_moderator()`, `is_blocked_between(a uuid, b uuid)`; profiles select policy extended to hide blocked pairs; trigger `apply_moderation_action` (suspend sets `suspended_until = now() + days` or `'infinity'`; unsuspend clears; warn inserts a notice; any action with a `report_id` marks that report `actioned`); trigger `limit_reports` (≤ 20 per reporter in 24 h); bucket `avatars` (private) with read for active authenticated, write/delete under `{auth.uid()}/`. `npm run build:setup-sql` concatenates migrations into `supabase/setup.sql` with a header comment.

- [ ] **Step 1: Failing tests:** block hides profiles both ways and unblock restores; only the blocker lists/deletes their blocks; reporting self fails; a suspended user cannot report; the 21st report in a day fails; a reporter sees only their reports; a non-moderator cannot select others' reports, update status, insert actions or insert into `moderators`; a moderator reads a suspended profile; a moderator can update only `status`/`resolved_by`/`resolved_at` on reports (column grant); a moderator dismisses (status `dismissed`), warns (notice appears for target, report `actioned`), suspends 7 days (target invisible to others) and unsuspends; a user reads and marks only their own notices; storage: a user can write `{own}/avatar.webp`, cannot write `{other}/…`, a suspended user cannot read avatars; deleting a user keeps reports about them with `reported` null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** migrations and the setup script. **Step 4: Run** `npm run test:supabase` → PASS; `npm run build:setup-sql` writes the file (commit it). **Step 5: Commit** `feat(supabase): blocks, reports, moderation and avatar storage policies`.

---

### Task 4: delete-account Edge Function

**Files:** Create `supabase/functions/delete-account/handler.ts` (pure, no Deno imports), `supabase/functions/delete-account/index.ts` (Deno entry: `Deno.serve`, builds the admin client from `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, calls `handle`), `tests/supabase/delete-account.test.ts`

**Interfaces — Produces:** `handle(req: Request, deps: { getUserId(jwt: string): Promise<string | null>; removeAvatars(uid: string): Promise<void>; deleteUser(uid: string): Promise<void> }): Promise<Response>` — 405 for non-POST, 401 without/invalid bearer, 200 `{ deleted: true }` after `removeAvatars` then `deleteUser`, 500 `{ error }` if either throws (no partial claim of success). CORS not needed (desktop client).

- [ ] **Step 1: Failing tests** for each status and call order. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(supabase): delete-account function`.

---

### Task 5: SocialBackend port, fake, and Supabase implementation

**Files:** Create `src/main/social/backend.ts`, `src/main/social/errors.ts`, `src/main/social/fake-backend.ts`, `src/main/social/supabase-backend.ts`, `src/main/social/session-store.ts`, `src/main/social/config.ts` · Test `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts` · install `@supabase/supabase-js@2.117.3`

**Interfaces — Produces:**
```ts
type SocialErrorKind = 'not_configured'|'offline'|'invalid_code'|'rate_limited'|'asleep'|'suspended'|'not_signed_in'|'forbidden'|'unknown'
class SocialError extends Error { kind: SocialErrorKind; until?: string }
interface SocialBackend {
  readonly configured: boolean
  sendCode(email: string): Promise<void>; verifyCode(email: string, code: string): Promise<{ userId: string; email: string }>
  session(): Promise<{ userId: string; email: string } | null>; signOut(): Promise<void>
  hasAcceptedCurrentDocuments(): Promise<boolean>; acceptDocuments(): Promise<void>   // all LEGAL_DOCUMENTS + age_18 at LEGAL_VERSION
  getOwnProfile(): Promise<SocialProfile | null>; saveProfile(draft: ProfileDraft): Promise<SocialProfile>
  uploadAvatar(webp: Uint8Array): Promise<void>; removeAvatar(): Promise<void>; avatarDataUrl(userId: string): Promise<string | null>
  block(userId: string): Promise<void>; unblock(userId: string): Promise<void>; listBlocks(): Promise<string[]>
  report(input: ReportInput): Promise<void>
  listNotices(): Promise<{ id: number; message: string; createdAt: string; read: boolean }[]>; markNoticeRead(id: number): Promise<void>
  isModerator(): Promise<boolean>; listOpenReports(): Promise<ModerationReport[]>
  actionsAbout(userId: string): Promise<{ action: string; reason: string; until: string | null; createdAt: string }[]>
  decide(decision: ModerationDecision): Promise<void>
  exportOwnData(): Promise<Record<string, unknown>>; deleteAccount(): Promise<void>
}
readSocialConfig(env): { url: string; key: string } | null   // null when missing, malformed, or a secret key
createSessionStore(vault-like deps): { getItem(k): string | null; setItem(k, v): void; removeItem(k): void }  // supabase-js storage adapter
```
`exportOwnData()` returns `{ exportedAt, account: { email }, profile, consents, blocks, reportsMade, notices, avatarUrl /* 1 h signed URL or null */ }`. The client is created with `auth: { storage: sessionStore, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }`.
`FakeSocialBackend(seed?)`: in-memory, OTP `123456`, seeded moderator/self/other users and two open reports when `seed: 'moderation'`.
SupabaseBackend error mapping: fetch failure → `offline`; GoTrue `otp_expired`/`invalid_credentials`/token errors → `invalid_code`; 429 or `over_email_send_rate_limit` → `rate_limited`; 5xx/`522`/`ENOTFOUND` on a configured host → `asleep`; RLS 42501 → `forbidden`; profile with future `suspended_until` on read → `suspended`.

- [ ] **Step 1: Failing tests:** `readSocialConfig` rejects `sb_secret_…` and a service_role JWT and accepts `sb_publishable_…`; session store round-trips through a fake safeStorage and never writes plain text; fake backend: full sign-up path, consents gate, block/report/decide semantics mirroring the SQL (blocked hidden, 21st report → `rate_limited`, non-moderator `decide` → `forbidden`); SupabaseBackend with an injected `global.fetch` that records requests: `sendCode` posts to `/auth/v1/otp` with `create_user: true`, `verifyCode` posts `type: 'email'`, a 429 body maps to `rate_limited`, a thrown `TypeError` maps to `offline`, `deleteAccount` calls `/functions/v1/delete-account` with the bearer token and maps a 404 to `unknown` with message "The delete-account function is not deployed."
- [ ] **Step 2: Run** `npm run test:main` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): social backend port with Supabase and fake implementations`.

---

### Task 6: Social IPC, avatar validation, export and delete

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/handlers.ts` (or new `src/main/ipc/social-handlers.ts` merged into the handler map), `src/main/app-context.ts`, `src/main/ipc/register.ts`, `src/preload/api.ts` · Create `src/main/social/avatar.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/avatar.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** channels and API (`window.devtalk.social` / `.safety` / `.moderation`):
`social:status` → `{ configured; signedIn; email: string|null; needsDocuments: boolean; hasProfile: boolean; suspendedUntil: string|null }`, `social:sendCode {email}`, `social:verifyCode {email, code /* 6–10 digits */}`, `social:acceptDocuments {}`, `social:getProfile {}`, `social:saveProfile ProfileDraft`, `social:setAvatar {bytes: Uint8Array}`, `social:removeAvatar {}`, `social:avatar {userId}` → data URL|null, `social:notices {}`, `social:readNotice {id}`, `social:signOut {}`, `social:export { includeLocal: boolean }` → `{ saved: boolean; path: string|null }` (main shows the save dialog), `social:deleteAccount { confirmEmail: string; deleteLocal: boolean }`; `safety:block {userId}`, `safety:unblock {userId}`, `safety:report ReportInput`; `moderation:isModerator {}`, `moderation:reports {}`, `moderation:history {userId}`, `moderation:decide ModerationDecision`. Errors use the existing `Result`; `AppErrorKind` gains `'not_configured'|'offline'|'invalid_code'|'asleep'|'suspended'|'not_signed_in'|'forbidden'` (`rate_limited` is reused, `unknown` maps to `internal`). A separate `toSocialAppError` uses the spec §3 copy (e.g. `rate_limited` → "Too many codes were sent. Wait a few minutes and try again.", `suspended` → "Your account is suspended until {date}." with the date from `SocialError.until`), so the coach copy stays unchanged.
`validateAvatar(bytes: Uint8Array): 'ok' | 'not_webp' | 'too_large'` (RIFF/WEBP magic, ≤ 200 KB). Deleting local data: close the DB, remove `devtalk.sqlite*` and key files, then `app.relaunch(); app.exit(0)`.

- [ ] **Step 1: Failing tests:** status transitions (signed out → code sent → verified needs documents → accepted needs profile → profile saved); `verifyCode` rejects `12a456` and 5 digits by schema; `validateAvatar` rejects a PNG header, a 201 KB WebP and accepts a small WebP; `deleteAccount` with a wrong `confirmEmail` → `validation` and the backend is not called; delete with the backend throwing `offline` keeps the session (status still signed in) — Review Focus 4; export with `includeLocal` includes `practice.attempts` from the study store; preload maps each new method to its channel.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npm run typecheck`. **Step 5: Commit** `feat(main): social, safety and moderation IPC`.

---

### Task 7: Renderer building blocks — stack logos, avatar, report and block

**Files:** Create `scripts/gen-stack-icons.mjs` (reads `simple-icons`, writes `src/renderer/lib/stack-icons.generated.ts` with `{ tag, title, path }` for a curated list of ~150 slugs and aliases e.g. `c++`→`cplusplus`, `js`→`javascript`), `src/renderer/lib/image.ts`, `src/renderer/design-system/StackTag.tsx`, `Avatar.tsx`, `ReportDialog.tsx`, `BlockButton.tsx` · Modify `components.css`, `ComponentsScreen.tsx` · Test `tests/renderer/stack-icons.test.ts`, `tests/renderer/image.test.ts`

**Interfaces — Produces:** `stackIconFor(tag: string): { title: string; path: string } | null`; `prepareAvatar(file: { type: string; size: number }, decode: (f) => Promise<ImageBitmapLike>): Promise<Uint8Array>` with `AvatarInputError('unsupported' | 'too_large')` before decoding (JPEG/PNG/WebP ≤ 8 MB), centre-crop + 256×256 + WebP 0.8 via canvas, re-encode at 0.6 if > 200 KB; `StackTag({ tag })` (icon 14 px `currentColor` + label; text only without icon); `Avatar({ src, name, size })` (initial in a circle on `--sheet-hover`); `ReportDialog({ open, target, onSubmit, onClose })` (`<dialog>`, reason radio list, details textarea ≤ 1000, focus returns); `BlockButton({ name, onBlock })` (confirm step inline, no modal).

- [ ] **Step 1: Failing tests:** `stackIconFor('Python')`, `'c++'`, `'React Native'` resolve; `'my-company-lib'` → null; the generated file contains only curated slugs (count ≤ 160); `prepareAvatar` rejects `image/svg+xml`, `image/gif` and a 9 MB JPEG before decode (Review Focus 5) and calls the encoder with 256×256 for a 1000×600 input (fake canvas deps).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (add `"gen:stack-icons"` script; commit the generated file). **Step 4: Run** → PASS; gallery shows the four components in both themes (screenshot check). **Step 5: Commit** `feat(renderer): stack logos, avatar, report and block components`.

---

### Task 8: Join flow, legal documents and People

**Files:** Create `docs/legal/terms.md`, `docs/legal/privacy.md`, `docs/legal/code-of-conduct.md`, `src/renderer/lib/markdown.ts` (headings, paragraphs, lists, bold, links only; no HTML), `src/renderer/screens/JoinScreen.tsx`, `src/renderer/screens/ProfileForm.tsx`, `src/renderer/screens/PeopleScreen.tsx`, `src/renderer/screens/LegalScreen.tsx` · Modify `App.tsx` (routes `people`, `people/edit`, `join`, `legal/:doc`), `src/renderer/lib/router.ts`, `screens.css` · Test `tests/renderer/markdown.test.ts`, `tests/e2e/social-join.spec.ts`

**Interfaces — Produces:** `renderMarkdown(src: string): MdNode[]` (pure; no raw HTML passes through). Join shows "Step N of 4". Steps: (1) e-mail, (2) code (6–10 digits, resend after 60 s), (3) documents + "I am 18 or older" (each document opens `#/legal/<doc>`; Continue disabled until all four checked), (4) `ProfileForm` (native language from `LANGUAGE_OPTIONS` in `screens/forms.ts`, prefilled with level from the local profile; timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`; stack input autocompletes from the curated `stackIconFor` list; optional photo with "Change photo" / "Remove photo"). Edit profile is the same form at `#/people/edit`. Legal documents are bundled with Vite `?raw` imports from `docs/legal/`. People: signed out → "Join the community" with what it is; not configured → "Community is not set up in this build"; signed in → own profile (Avatar, name, level, language, timezone, area, StackTags, availability in the viewer's words, bio) + Edit profile; unread notices on top as a Notice with "Mark as read"; a suspended account sees "Your account is suspended until {date}." and no Edit profile.

- [ ] **Step 1: Failing tests:** markdown escapes `<script>` as text and renders `**bold**`, lists and links; e2e with `DEVTALK_FAKE_SOCIAL=1`: full join (code `123456`) lands on People with the profile; wrong code shows "That code did not work…"; quitting after verifying the code and relaunching resumes at the documents step (Review Focus 3); a photo upload from `tests/e2e/assets/photo.jpg` shows the avatar; an SVG is refused with the message.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write the documents** (plain English; privacy covers data, purpose, legal basis, Supabase São Paulo as processor, LGPD rights and where to exercise them in the app, contact `noreplaydevtalk@gmail.com` replaced by the owner's contact if they give one; each document states it is not legal advice) **and implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): join flow, legal documents and people screen`.

---

### Task 9: Settings › Account

**Files:** Modify `src/renderer/screens/SettingsScreen.tsx`, `screens.css` · Test `tests/e2e/social-account.spec.ts`

**Interfaces — Produces:** an "Account" section: signed out → "Join the community" link; signed in → e-mail, Sign out, Export my data (checkbox "Include my practice history"), Delete my account (inline confirm: type your e-mail; checkbox "Also delete my practice data on this computer"; destructive button).

- [ ] **Step 1: Failing e2e:** sign out returns People to the join state; export writes a JSON file (save dialog stubbed via `app.evaluate` on `dialog.showSaveDialog`) containing `profile` and, when checked, `practice`; delete with the wrong e-mail keeps the button disabled; delete with the fake backend set offline shows "You are offline…" and stays signed in (Review Focus 4); delete success returns to the join state.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): account settings with export and delete`.

---

### Task 10: Moderation screen

**Files:** Create `src/renderer/screens/ModerationScreen.tsx` · Modify `Rail.tsx` (Moderation item only when `moderation.isModerator()`), `App.tsx` (route + palette command when moderator), `screens.css` · Test `tests/e2e/moderation.spec.ts`

**Interfaces — Produces:** ruled list of open reports (date, reason, context, reported person with Avatar + name, details); selecting one shows the person's past actions and the decisions Dismiss, Warn (message field), Suspend (1/7/30 days/permanent + reason), Unsuspend; empty state "No open reports."

- [ ] **Step 1: Failing e2e** (fake seed `moderation`, signed in as the seeded moderator): two reports listed; Warn removes the report from the list and the target's notices contain the message; Suspend 7 days marks the person suspended in history; a non-moderator has no Moderation item and `#/moderation` shows "Only moderators can see this."
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): moderation screen`.

---

### Task 11: Go live on the user's project (guided)

**Files:** Create `src/main/social/cli.ts` (`--social-smoke`) · Modify `src/main/cli.ts`, `README.md` (Community setup section)

- [ ] **Step 1:** Guide the user, in the browser, to paste `supabase/setup.sql` in SQL Editor › Run; read back the result (they report "Success" or the error text).
- [ ] **Step 2:** Guide them to create the Edge Function `delete-account` in the dashboard editor by pasting a single-file version (`supabase/functions/delete-account/index.ts` with the handler inlined; generate it with `npm run build:edge`), and to keep "Enforce JWT" on.
- [ ] **Step 3:** `npm run cli -- --social-smoke`: zenity asks the e-mail, sends a code, zenity asks the code, verifies, accepts documents, upserts a minimal profile, reads it back, prints `ok` or the error kind. Then guide the moderator insert (spec §10) and confirm `moderation:isModerator` is true via a second `--social-smoke --check-moderator`.
- [ ] **Step 4:** README section "Community (Supabase)". **Step 5: Commit** `feat: social smoke and community setup guide`.

---

### Task 12: Screenshot round, finish review, DESIGN.md extension

- [ ] **Step 1:** Extend `tests/e2e/screenshots.spec.ts` (fake social) with Join (each step), People (own profile with photo and logos), Edit profile, Settings › Account, Moderation, ReportDialog open — dark/light × 1440/960; inspect once in contact sheets, fix in one batch, recapture, second look; run the detector on `src/renderer`.
- [ ] **Step 2:** Spawn the impeccable finish reviewer (same packet shape as phase 1, artifact `src/renderer`, the new screenshots, DESIGN.md as the incumbent system) and act on its disposition.
- [ ] **Step 3:** Spawn the documenter to extend DESIGN.md / design.json for the new components (Avatar, StackTag, ReportDialog, BlockButton, moderation list) without rewriting the system.
- [ ] **Step 4:** `npm test && npm run test:e2e && npm run typecheck` green. **Step 5: Commit** `docs(design): social screens review and DESIGN.md extension`.
