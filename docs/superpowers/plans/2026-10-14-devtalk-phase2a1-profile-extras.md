# DevTalk Phase 2A.1 (Badges, Practice Graph, Banner, Mascots) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profiles get Discord-style badges (community, technical, evolution), a GitHub-style green practice graph, an animated banner, and one of nine library mascots as the default picture — on the live Supabase project, with every new rule proven offline.

**Architecture:** One new migration (`0004_profile_extras.sql`) adds profile columns, `practice_days`, `milestones`, `badge_grants`, badge moderation actions, and two security-definer readers (`profile_badges`, `practice_streaks`) plus a private `banners` bucket. The main process gains a practice-sync service (local SQLite → day counts → only changed days uploaded), banner metadata stripping, and new `SocialBackend` methods behind the existing zod IPC. The renderer adds Badge, PracticeGraph and Banner components, mascot fallbacks in `Avatar`, and a Badges area in Moderation.

**Tech Stack:** unchanged (Electron 44, React 19, TS 6, vitest 5, Playwright, zod 4, supabase-js 2.117.3, PGlite 0.5.9, simple-icons 16.35.0). No new dependencies; `ImageDecoder` and `OffscreenCanvas` are Chromium built-ins.

**Spec:** `docs/superpowers/specs/2026-10-14-devtalk-phase2a1-profile-extras-design.md` · Visual authority: `DESIGN.md` + the approved mockups in `.superpowers/brainstorm/74256-1792004093/content/` (`badge-colors.html`, `activity-graph.html` option A, `banner-layout.html` option A) · Mascots: `docs/design/mascots/`.

## Global Constraints

- `setup.sql` is live: schema changes go only in `supabase/migrations/0004_profile_extras.sql` (pasted alone), and `npm run build:setup-sql` still regenerates the full file for new projects. Never edit 0001–0003.
- Badge ids and labels exactly as the spec §2 table; community = violet, evolution = copper, area/linux = neutral, languages = brand colour; label text always in ink.
- Founding member: `profiles.created_at < '2027-01-01 00:00:00 America/Sao_Paulo'`.
- Streak: consecutive days with ≥1 activity ending today or yesterday in the profile's time zone; show only `streak_30` when ≥30, else `streak_7` when ≥7.
- Graph: 53 weeks, Monday first; `points = answers × 5 + reviews`; levels 0 | 1–9 | 10–24 | 25–49 | 50+.
- Limits: `main_stack` ≤ 2 and `<@ stack`; `practice_days.answers` 0–500, `reviews` 0–2000, `day` within [today−400, today+1] (UTC date); milestones `level_up` = `<from>><to>` with from < to in A2..C2, `vocabulary` ∈ {50, 100}; manual badges via moderators ∈ {beta_tester, mentor, open_source}; `creator` only by SQL Editor.
- Banner: input ≤ 8 MB; static → centre 3:1, 1500×500 WebP q0.8 (q0.6 if > 2 MB); animated (GIF, WebP with ANIM) ≤ 2 MB, 600×200 … 4096×4096, metadata stripped in main without re-encoding; bucket `banners` private, `image/gif`/`image/webp`, 2 MB.
- Mascots: 9 ids `duck-1..3`, `bear-1..3`, `axolotl-1..3`; default `fnv1a32(userId) % 9`; photo always wins.
- Animations stop with `prefers-reduced-motion` and with the local setting "Play animated banners" (`localStorage['devtalk.playAnimations'] !== 'off'`).
- Legal documents get a new dated version (the day of implementation); `LEGAL_VERSION` changes with them so everyone re-accepts.
- Keep the agents view current: `node .superpowers/agents-view/agent.mjs` (task/say/commit/tests) at each task start, commit and finish — the user asked to watch the work.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Hidden progress leaking** — with `show_progress = false`, other members must not read `practice_days`, `milestones`, evolution badges or streaks (directly or through `profile_badges` / `practice_streaks`); the owner still sees them. Tests in Task 2.
2. **Forged badges** — a member inserting `badge_grants`, granting themselves through `moderation_actions`, granting `creator`, sending an invalid milestone value, or practice days far in the past/future. Tests in Task 2.
3. **Hostile banner input** — a 30 MB file, a PNG renamed `.gif`, a GIF claiming 60000×60000, a truncated WebP, a WebP carrying EXIF/XMP/GPS: refused with a clear message or cleaned, never uploaded raw. Tests in Tasks 3 and 9.
4. **Day boundaries** — activity at 23:59 and 00:01 local time, a profile time zone different from the machine's, DST changes: the graph and the streak neither drop nor double a day. Tests in Tasks 1, 2 and 5.
5. **Sync storms and offline** — twenty answers in a row produce one upload; offline uploads fail quietly, retry later and never block practice or show an error over the coach. Tests in Task 5.

---

### Task 1: Core — profile extras, mascots, graph and streak rules

**Files:** Modify `src/core/social/types.ts`, `src/core/social/validate.ts` · Create `src/core/social/badges.ts`, `src/core/social/mascots.ts`, `src/core/progress/practice.ts` · Test `tests/core/profile-extras.test.ts`

**Interfaces — Produces:**
```ts
// types.ts
MASCOTS = ['duck-1','duck-2','duck-3','bear-1','bear-2','bear-3','axolotl-1','axolotl-2','axolotl-3'] as const; type MascotId
SocialProfile += { mainStack: string[]; showProgress: boolean; mascot: MascotId | null; hasBanner: boolean }
ProfileDraft = Omit<SocialProfile, 'id'|'hasAvatar'|'suspendedUntil'|'hasBanner'>   // now includes mainStack, showProgress, mascot
type BadgeGroup = 'community' | 'technical' | 'language' | 'evolution'
interface Badge { id: string; group: BadgeGroup; label: string; detail: string | null }   // id e.g. 'moderator', 'area:backend', 'lang:python', 'streak_30'
// badges.ts
MANUAL_BADGES = ['beta_tester','mentor','open_source'] as const; type ManualBadge = (typeof MANUAL_BADGES)[number]; BADGE_LABELS: Record<string,string>  // spec §2
// mascots.ts
fnv1a32(s: string): number; mascotFor(userId: string, chosen: MascotId | null): MascotId
// practice.ts
interface DayActivity { day: string /* YYYY-MM-DD */; answers: number; reviews: number }
bucketByDay(answers: string[], reviews: string[], timeZone: string): DayActivity[]   // ISO timestamps → local days, sorted
graphLevel(a: DayActivity): 0|1|2|3|4
streaks(days: DayActivity[], today: string): { current: number; longest: number }
graphWeeks(days: DayActivity[], today: string): (DayActivity & { level: 0|1|2|3|4 })[][]   // 53 columns × 7 (Mon..Sun), missing days zero
```
ProfileDraftSchema: `mainStack` ≤ 2 and every item in `stack`; `mascot` null or a MascotId; `showProgress` boolean.

- [ ] **Step 1: Failing tests:** `mascotFor('x', null)` is stable and in MASCOTS; a sample of 200 uuids hits all 9; `mascotFor(id, 'bear-2') === 'bear-2'`; `bucketByDay` puts `2026-10-14T02:30:00Z` on 2026-10-13 in America/Sao_Paulo and on 2026-10-14 in UTC (Review Focus 4); `graphLevel` thresholds (0, 1, 9→1, 10→2, 24, 25→3, 49, 50→4 points); `streaks` — gap breaks current, yesterday-only still counts, today+yesterday counts, longest across history; `graphWeeks` gives 53 columns starting on a Monday and ending in the week of `today`; draft with 3 main stacks or a main stack not in `stack` fails.
- [ ] **Step 2: Run** `npm run test:core` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (update existing core social tests for the new draft fields). **Step 5: Commit** `feat(core): profile extras, mascots, practice graph and streak rules`.

---

### Task 2: Migration 0004 — badges, practice days, milestones, banners

**Files:** Create `supabase/migrations/0004_profile_extras.sql`, `tests/supabase/extras.test.ts` · Modify `tests/supabase/stubs.sql` only if a stub is missing · Regenerate `supabase/setup.sql`

**Interfaces — Produces (SQL):** columns `main_stack`, `uses_linux`, `show_progress`, `banner_path`, `mascot` (+ column grants: select all new; insert/update all but none of the server-owned ones); tables `practice_days`, `milestones`, `badge_grants`; `moderation_actions.badge` + action check extended with `grant_badge`/`revoke_badge` and `(action in ('grant_badge','revoke_badge')) = (badge is not null)`; trigger applies grants/revokes and inserts notice "You received the {label} badge."; `practice_streaks(target uuid) → table(current int, longest int)` and `profile_badges(target uuid) → table(id text, grp text, label text, detail text)` (security definer, empty when the caller cannot see the target; evolution rows only when `show_progress` or caller is the target); `can_see_banner(name)`; bucket `banners` + four storage policies mirroring avatars.

- [ ] **Step 1: Failing tests** (each named): owner sets main_stack/mascot/show_progress/banner_path; `main_stack` of 3 or not in stack fails; owner upserts own practice day, cannot write another's, cannot write day today−401 or today+2, cannot exceed 500 answers; others read practice days only while `show_progress` and visible (blocked → none, suspended → none) — Review Focus 1; milestone `B1>B2` ok, `B2>B1`, `B1>B1`, `vocabulary/75` fail; no update on milestones; member cannot insert `badge_grants`; moderator grants Mentor via `moderation_actions` → `badge_grants` row + notice; revoke removes; moderator cannot grant to self, cannot grant `creator`; `profile_badges` returns moderator, founding_member (created before cutoff; not after), `area:backend` (none for `other`), `lang:python` from main_stack, `linux`, manual badges, `streak_7` at 7 consecutive days ending yesterday, `streak_30` replaces it at 30, `level_up` latest, `vocabulary` 100 over 50, and drops evolution rows for others when `show_progress` is false; `practice_streaks` uses the profile time zone (a day logged as 2026-10-13 counts as "yesterday" on 2026-10-14 in America/Sao_Paulo) — Review Focus 4; banner object writes only under own folder, `.gif`/`.webp` names only; blocked pair cannot read each other's banner.
- [ ] **Step 2: Run** `npm run test:supabase` → FAIL. **Step 3: Write 0004.** **Step 4: Run** → PASS; `npm run build:setup-sql`; drift test passes. **Step 5: Commit** `feat(supabase): badges, practice days, milestones and banners (0004)`.

---

### Task 3: Main — banner validation and metadata stripping

**Files:** Create `src/main/social/media.ts` · Test `tests/main/media.test.ts`

**Interfaces — Produces:**
```ts
type BannerKind = 'gif' | 'webp-animated' | 'webp-static'
inspectBanner(bytes: Uint8Array): { kind: BannerKind; width: number; height: number } | { error: 'unsupported' | 'too_large' | 'bad_dimensions' | 'corrupt' }
stripGifMetadata(bytes: Uint8Array): Uint8Array      // drops comment (0xFE), plain-text (0x01), application ext except NETSCAPE2.0 / ANIMEXTS1.0
stripWebpMetadata(bytes: Uint8Array): Uint8Array     // drops EXIF and 'XMP ' chunks, clears VP8X EXIF/XMP flags, fixes RIFF size
prepareBannerUpload(bytes: Uint8Array): { bytes: Uint8Array; ext: 'gif' | 'webp' } | { error: string }   // the only entry point used by handlers
```
Rules: ≤ 2 MB after stripping; animated must be 600×200…4096×4096; static WebP (already 1500×500 from the renderer) ≤ 2 MB; anything else `unsupported`.

- [ ] **Step 1: Failing tests** with byte-built fixtures (helpers in the test file): GIF89a with a comment and a NETSCAPE loop → comment gone, loop kept, frames identical; GIF with XMP application extension → gone; WebP VP8X+ANIM+EXIF+XMP → EXIF/XMP gone, flags cleared, RIFF size = length−8, still parses; PNG bytes named anything → `unsupported`; GIF header claiming 60000×60000 → `bad_dimensions`; truncated GIF/WebP → `corrupt`; 2 MB + 1 → `too_large` (Review Focus 3).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): banner inspection and metadata stripping`.

---

### Task 4: Backend — new SocialBackend methods (fake + Supabase)

**Files:** Modify `src/main/social/backend.ts`, `fake-backend.ts`, `supabase-backend.ts` · Test `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts`

**Interfaces — Produces:**
```ts
SocialBackend += {
  badges(userId: string): Promise<Badge[]>
  practiceGraph(userId: string): Promise<{ days: DayActivity[]; current: number; longest: number }>
  publishPracticeDays(days: DayActivity[]): Promise<void>        // upsert own rows
  publishMilestone(kind: 'level_up' | 'vocabulary', value: string): Promise<void>   // insert, ignore duplicates
  setUsesLinux(on: boolean): Promise<void>
  uploadBanner(bytes: Uint8Array, ext: 'gif' | 'webp'): Promise<void>   // removes the other extension, sets banner_path
  removeBanner(): Promise<void>
  bannerDataUrl(userId: string): Promise<string | null>
  searchMembers(query: string): Promise<{ id: string; displayName: string; hasAvatar: boolean; mascot: MascotId | null }[]>   // moderators only, ≤ 20
  grantBadge(userId: string, badge: ManualBadge, reason: string): Promise<void>
  revokeBadge(userId: string, badge: ManualBadge, reason: string): Promise<void>
}
```
`ModerationReport.reported` gains `mascot: MascotId | null` and `hasAvatar` so the queue shows the chosen mascot. Profile reads/writes carry `mainStack`, `showProgress`, `mascot`, `hasBanner` (explicit column list stays — never `suspended_until`). Fake mirrors every SQL rule (Review Focus 1–2); its moderation seed gains practice days and one Mentor grant.

- [ ] **Step 1: Failing tests:** fake — badges for the seeded moderator include Moderator and Founding member; hiding progress hides evolution for others; grantBadge by non-moderator → `forbidden`, on self → `forbidden`; banner upload then `bannerDataUrl` → `data:image/gif;base64,…`. Supabase (recorded fetch) — `badges` calls `rpc/profile_badges` with `{target}`; `practiceGraph` reads `practice_days` (select day,answers,reviews, last 371 days) and `rpc/practice_streaks`; `publishPracticeDays` POSTs with `on_conflict=user_id,day`; `uploadBanner('gif')` uploads `{uid}/banner.gif` with `image/gif`, removes `banner.webp`, PATCHes `banner_path`; `grantBadge` inserts into `moderation_actions` with `action: 'grant_badge'`.
- [ ] **Step 2: Run** `npm run test:main` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): badges, practice graph, banner and badge moderation in the social backend`.

---

### Task 5: Main — practice sync service

**Files:** Create `src/main/social/practice-sync.ts` · Modify `src/core/ports.ts` (+ `activityTimestamps(since: Date): { answers: string[]; reviews: string[] }`), `src/core/testing/memory-store.ts`, `src/main/db/sqlite-store.ts`, `src/main/ipc/handlers.ts` (deps `onActivity?(kind: 'answer' | 'review' | 'level', detail?: string)` called after `feedback:submit`, `review:rate`, and `profile:save` when `currentLevel` rises), `src/main/app-context.ts` · Test `tests/main/practice-sync.test.ts`, store contract test addition

**Interfaces — Produces:**
```ts
createPracticeSync(deps: { store: StudyStore; backend: SocialBackend; clock: Clock; timeZone: () => string; platform: NodeJS.Platform;
  statePath: string | null; debounceMs?: number /* 5000 */; schedule?: (fn: () => void, ms: number) => { cancel(): void } }):
  { start(): Promise<void>; notify(kind: 'answer' | 'review' | 'level', detail?: string): void; flush(): Promise<void> }
```
Only for members (`session` + documents + profile, not suspended). Sends days of the last 400 that differ from `statePath` cache; vocabulary milestones from `store.expressionCount()` ≥ 50 / ≥ 100; `level_up` from `notify('level', 'B1>B2')`; `setUsesLinux(platform === 'linux')` once per start. Errors are swallowed and logged; cache is updated only after a successful upload.

- [ ] **Step 1: Failing tests:** store contract — `activityTimestamps` returns feedback and review_log timestamps since a date (both stores); sync — first `start()` uploads all non-zero days, second uploads nothing; a new answer + `notify('answer')` × 20 within the debounce → exactly one upload with only today (Review Focus 5); backend throwing `offline` → no throw, cache unchanged, next flush retries; non-member → no calls; 50 expressions → one `vocabulary/50` milestone; `notify('level','B1>B2')` → milestone once; handler test: `profile:save` raising B1→B2 calls `onActivity('level','B1>B2')`, lowering does not.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire** (start after window ready; never awaited by IPC handlers). **Step 4: Run** `npm test` → PASS. **Step 5: Commit** `feat(main): practice sync to the community`.

---

### Task 6: IPC — channels for badges, graph, banner, mascots and badge moderation

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/social-handlers.ts`, `src/main/ipc/handlers.ts`, `src/preload/api.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** `social:badges {userId}` → `Badge[]`; `social:practiceGraph {userId}` → `{days, current, longest}`; `social:setBanner {bytes}` → data URL (main runs `prepareBannerUpload`; errors → `validation` with "The banner must be a GIF or WebP under 2 MB, at least 600 × 200." or "This image could not be read. Try another one."); `social:removeBanner`; `social:banner {userId}` → data URL | null; `moderation:searchMembers {query 1–40}`; `moderation:grantBadge {userId, badge, reason 1–200}`; `moderation:revokeBadge {…}`; `progress:graph {}` → `{ days, current, longest }` from the local store (core `bucketByDay` + `streaks`, machine time zone). `social:saveProfile` accepts the new draft fields. API: `social.badges/practiceGraph/setBanner/removeBanner/banner`, `moderation.searchMembers/grantBadge/revokeBadge`, `progress.graph`.

- [ ] **Step 1: Failing tests:** each channel validates input (bad badge id, empty reason, 41-char query → `validation`); setBanner with a PNG → the GIF/WebP message; non-moderator grant → "Only moderators can see this."; `progress:graph` returns today's answer under today's local day; preload maps each method.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run typecheck` → PASS. **Step 5: Commit** `feat(main): IPC for badges, practice graph, banner and badge moderation`.

---

### Task 7: Renderer foundations — tokens, language colours, Badge, mascots in Avatar

**Files:** Modify `scripts/gen-stack-icons.mts` (emit `hex` per icon + `BRAND_OVERRIDES` {openjdk/java: `#ED8B00`, black → curated}), regenerate `stack-icons.generated.ts`; Create `src/renderer/lib/colour.ts` (`contrast(a,b)`, `ensureContrast(hex, against, min=3)`), `src/renderer/lib/badges.ts` (icon per badge id; drawn 16px stroke icons per the approved mock), `src/renderer/design-system/Badge.tsx` (`Badge`, `BadgeRow`), copy `docs/design/mascots/*.webp` → `src/renderer/assets/mascots/`; Modify `Avatar.tsx` (`userId?`, `mascot?` → mascot image when no photo), `tokens.css` (`--badge-community`, `--badge-evolution`, `--graph-0..4`, both themes), `components.css` · Test `tests/renderer/colour.test.ts`, `tests/renderer/badges.test.ts`

**Interfaces — Produces:** `languageColour(tag, theme: 'dark'|'light'): string` (≥ 3:1 against the theme background); `<Badge badge={Badge} theme? />`; `<BadgeRow badges={Badge[]} />` (order community → technical → language → evolution); `<Avatar src name userId mascot size />`.

- [ ] **Step 1: Failing tests:** `ensureContrast('#00599C', '#16181d')` ≥ 3:1 and minimal change; every curated language colour ≥ 3:1 in both themes; Java → orange; every badge id in BADGE_LABELS has an icon; mascot asset exists for all 9 ids.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (gallery gets a badge row and the 9 mascots). **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): badge chips, language colours and mascot avatars`.

---

### Task 8: Renderer — PracticeGraph and Progress

**Files:** Create `src/renderer/design-system/PracticeGraph.tsx` · Modify `src/renderer/screens/ProgressScreen.tsx`, `components.css` · Test `tests/renderer/graph.test.ts` (labels/tooltip text helpers)

**Interfaces — Produces:** `<PracticeGraph days current longest today />` — 53×7 grid from `graphWeeks`, month labels, Mon/Wed/Fri, legend "Less … More", facts line, one focusable grid (`role="grid"` with arrow keys; the active cell's text in a live region), tooltip "14 Oct: 2 answers, 15 reviews" / "14 Oct: no practice", horizontal scroll starting at the end on narrow widths.

- [ ] **Step 1: Failing tests:** `cellLabel` texts (singular/plural, no practice); month label positions for a year crossing January; facts line text.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + Progress integration** (`progress.graph()` above the existing sections; empty state when no activity). **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): practice graph on Progress`.

---

### Task 9: Renderer — banner, profile layout and Edit profile

**Files:** Create `src/renderer/design-system/Banner.tsx`, `src/renderer/lib/motion.ts` (`playAnimations()`, `setPlayAnimations(on)`, reduced-motion aware), extend `src/renderer/lib/image.ts` (`prepareBanner(file, deps)`: static → 1500×500 WebP; GIF/WebP-animated → pass-through after type/size checks), `image-browser.ts` (animated detection via `ImageDecoder`, first-frame capture) · Modify `PeopleScreen.tsx` (banner + overlapping avatar + BadgeRow + PracticeGraph), `ProfileForm.tsx` (banner add/change/remove, "Main" toggles ≤ 2 on stack tags, "Show my practice graph and progress badges to other members", mascot picker row), `SettingsScreen.tsx` ("Play animated banners"), `screens.css` · Test `tests/renderer/image.test.ts` (banner cases), `tests/renderer/motion.test.ts`

**Interfaces — Produces:** `<Banner src name />` (3:1 cover; paused = first frame); `BannerInputError('unsupported' | 'too_large')` with messages "Choose a GIF, WebP, JPEG or PNG image." / "Choose an image under 8 MB." / "An animated banner must be under 2 MB."

- [ ] **Step 1: Failing tests:** prepareBanner refuses SVG, 9 MB, animated 3 MB; static 3000×1000 → encoder called with crop 3:1 and 1500×500; `playAnimations()` false when stored 'off' or reduced motion.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; quick scratch screenshot of People (dark 1440, light 960). **Step 5: Commit** `feat(renderer): animated banner, badges and graph on People; profile extras in Edit profile`.

---

### Task 10: Moderation — Badges area

**Files:** Modify `src/renderer/screens/ModerationScreen.tsx`, `screens.css` · Test `tests/e2e/moderation.spec.ts`

**Interfaces — Produces:** a "Badges" section on Moderation: search box (debounced 300 ms) → ruled list of members (Avatar/mascot + name) → selected member's BadgeRow + grant/revoke for the three manual badges with a required reason.

- [ ] **Step 1: Failing e2e** (seed `moderation`): search "Sam" → one result; grant Mentor with a reason → Sam's badges include Mentor and the fake state has the notice "You received the Mentor badge."; revoke removes it; a member without moderation sees no Badges section.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(renderer): badge moderation`.

---

### Task 11: Documents — product, privacy, terms

**Files:** Modify `PRODUCT.md`, `docs/legal/privacy.md`, `docs/legal/terms.md`, `docs/legal/code-of-conduct.md` (version line only), `src/core/social/types.ts` (`LEGAL_VERSION` → implementation date), tests that pin the version, `README.md` (Community section: 0004 + Creator insert)

- [ ] **Step 1: Failing test:** core test pins the new `LEGAL_VERSION`; an e2e checks a signed-in member with old acceptances lands on the documents step again.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write** (privacy: daily counts only, milestones, badges, banner, what is public, how to hide; terms: banner in "What you share"; PRODUCT.md: the three commitment changes from spec §7). **Step 4: Run** → PASS. **Step 5: Commit** `docs: product commitments and legal documents for profile extras`.

---

### Task 12: E2E, screenshots, design review, DESIGN.md

- [ ] **Step 1:** `tests/e2e/profile-extras.spec.ts` (fake social): mascot shown without photo and changeable; photo wins over mascot; badges visible on People (Moderator/Founding member for the seed); main language toggle shows Python badge; hiding progress keeps own view; graph tooltip after one answer; animated banner upload shows `data:image/gif`; with "Play animated banners" off the banner `src` is a still image.
- [ ] **Step 2:** extend `screenshots.spec.ts` (People with banner + badges + graph, Edit profile extras, Progress graph, Moderation badges) both themes × 1440/960; inspect via contact sheets, fix in one batch, recheck once; run the detector.
- [ ] **Step 3:** impeccable finish reviewer (approved mockups as the comp), act on fixes; documenter extends DESIGN.md/design.json (badge colours, graph ramp, banner, mascots) without rewriting.
- [ ] **Step 4:** `npm test && npm run test:e2e && npm run typecheck` green. **Step 5: Commit** `test: profile extras end to end; docs(design): badges, graph, banner, mascots`.

---

### Task 13: Go live (guided, after the final code review)

- [ ] Paste `supabase/migrations/0004_profile_extras.sql` in the SQL Editor (copy page in the agents view, like 2A); verify with anonymous probes (`practice_days` → 42501).
- [ ] Creator grant: `insert into badge_grants (user_id, badge, granted_by) values ('362f7b40-f2e3-4623-9d92-7146cf81ef62','creator','362f7b40-f2e3-4623-9d92-7146cf81ef62');`
- [ ] `npm run cli -- --social-smoke --check-moderator`; the user opens People, re-accepts the documents, sees badges, graph and mascot.
