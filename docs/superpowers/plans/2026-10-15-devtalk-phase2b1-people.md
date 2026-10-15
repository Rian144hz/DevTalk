# DevTalk Phase 2B.1 (Member List, Profiles, Follow, Like) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members find each other: a filterable member list, other people's full profiles, follow (with a notice and public counts and lists) and profile likes with a public count — on the live Supabase project, with every rule proven offline.

**Architecture:** One migration (`0006_people.sql`) adds `follows`, `profile_likes`, `profiles.listed`, notice kind/actor, triggers (daily limits, follow notice with a 7-day dedupe, block clears ties) and security-definer readers (`profile_social`, `member_directory`, `followers_of`, `following_of`, `my_social_export`); clients never select the new tables directly. The main process gains `SocialBackend` methods behind zod IPC; the renderer splits People into Members / Following / Your profile tabs and adds the other-person profile and follower lists.

**Tech Stack:** unchanged (Electron 44, React 19, TS 6, vitest, Playwright, zod 4, supabase-js 2.117.3, PGlite). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-devtalk-phase2b1-people-design.md` · Visual authority: `DESIGN.md` + `.impeccable/design.json`; reuse the People profile layout, `BadgeRow`, `Avatar` (mascots), ruled lists and `EmptyState`.

## Global Constraints

- 0001–0005 are live: schema changes go only in `supabase/migrations/0006_people.sql` (pasted alone); `npm run build:setup-sql` regenerates `setup.sql`; the drift test stays green. Never edit 0001–0005.
- Likes count, follower/following counts and follower/following lists are public **to members**; anon reads nothing. No ranking anywhere: the member list orders by level distance to the caller (A2…C2), then display name, then id — never by popularity.
- Follow notice: `kind 'follow'`, `actor` = follower, message `'<display name> followed you.'`; at most one per (actor, user) per 7 days. Likes never notify.
- Limits: 200 follows and 200 likes created per person per 24 h (trigger messages `follow limit reached` / `like limit reached`); page size 30; search text ≤ 40 characters; `%`, `_` and `\` escaped.
- Blocked pairs (either direction) and suspended people never appear in lists or counts; blocking deletes follows and likes between the two both ways. `listed = false` only removes a person from `member_directory`.
- Following or liking yourself is refused in main with "You cannot follow yourself." / "You cannot like your own profile." (and by RLS).
- New `LEGAL_VERSION` = the implementation date; terms, privacy and conduct version lines change with it.
- Unit tests always with `--maxWorkers=2` (6.7 GB machine froze at default parallelism).
- Keep the agents view current (`node .superpowers/agents-view/agent.mjs task|say|commit|tests`); give `status.json` a 2B.1 task list before Task 1.
- Interface copy in simple English (B1); commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Leaks through blocks and suspensions** — a blocked or suspended person counted in someone's followers/likes, shown in a third person's follower list, found by name search, or able to follow/like through the API. Tests in Task 2.
2. **Spam and abuse** — follow/unfollow loops flooding notices, the 201st follow in a day, self-follow or self-like through the API, liking a hidden or suspended profile. Tests in Task 2.
3. **Hidden members** — `listed = false` absent from the member list (including exact-name search) but present in follower lists, with the profile still reachable. Tests in Task 2.
4. **Directory input** — `%`, `_`, `\` and non-Latin names in search, page −1 or 10 000, empty filters, a stack tag in another case. Tests in Tasks 2 and 4.
5. **Stale UI state** — double-clicking Follow or ♥, counts after undo, opening the profile of someone who blocked you or deleted their account (clear "This profile is not available." state). Tests in Tasks 6 and 9.

---

### Task 1: Core — people types and draft field

**Files:** Modify `src/core/social/types.ts`, `src/core/social/validate.ts` · Test `tests/core/social.test.ts`, `tests/core/profile-extras.test.ts`

**Interfaces — Produces:**
```ts
SocialProfile += { listed: boolean }            // ProfileDraft gains `listed` (same Omit)
interface MemberRow { id: string; displayName: string; level: Level; area: Area; mainStack: string[]; mascot: MascotId | null; hasAvatar: boolean }
interface SocialStats { followers: number; following: number; likes: number; iFollow: boolean; iLike: boolean }
interface MemberFilters { query?: string; level?: Level; area?: Area; stack?: string }
const MEMBER_PAGE_SIZE = 30; const MEMBER_QUERY_MAX = 40;
NoticeKind = 'moderation' | 'follow'
```
`ProfileDraftSchema` requires `listed: boolean`. `memberLine(row)` → `"Back end developer, B1"` (`"Developer, B1"` for area `other`).

- [ ] **Step 1: Failing tests:** draft without `listed` fails, with it passes; `memberLine` for backend/B1 and other/C1.
- [ ] **Step 2: Run** `npx vitest run --project core --maxWorkers=2` → FAIL. **Step 3: Implement** (add `listed: true` defaults at every draft consumer: JoinScreen, PeopleScreen, ProfileForm, cli smoke, tests). **Step 4: Run** → PASS + `npm run typecheck`. **Step 5: Commit** `feat(core): people types and the listed profile field`.

---

### Task 2: Migration 0006 — follows, likes, listing and readers

**Files:** Create `supabase/migrations/0006_people.sql`, `tests/supabase/people-follow.test.ts` · Modify `tests/supabase/people.ts` (helper `block(t, a, b)`) only if missing · Regenerate `supabase/setup.sql`

**Interfaces — Produces (SQL):** tables `follows(follower, followee, created_at)` and `profile_likes(liker, profile, created_at)` (PK, no-self check, cascade); `profiles.listed boolean not null default true` (+ select/insert/update column grants); `notices.kind text not null default 'moderation' check in ('moderation','follow')`, `notices.actor uuid references auth.users on delete set null` (select grant); RLS insert own row when `viewer_is_member()` and `can_see_profile(target)`, delete own row, **no select grant**; limit triggers; `after insert` follow-notice trigger with 7-day dedupe; `after insert on blocks` trigger deleting ties both ways; functions (security definer, revoked from public/anon, granted to authenticated):
`profile_social(target uuid) → table(followers int, following int, likes int, i_follow bool, i_like bool)`,
`member_directory(q text, lvl text, area text, stack text, page int) → table(id uuid, display_name text, level text, area text, main_stack text[], mascot text, has_avatar bool)`,
`followers_of(target uuid, page int)` / `following_of(target uuid, page int)` → same columns,
`my_social_export() → json {following, followers, likesGiven}` (with dates). Pages clamp to ≥ 0; `q` and `stack` compared case-insensitively.

- [ ] **Step 1: Failing tests** (each named): follow/unfollow own rows only; self-follow/self-like fail; follow a blocked (either way) or suspended member fails (Review Focus 1); non-member cannot follow; anon cannot call any reader; no direct select on `follows`/`profile_likes` for authenticated; the 201st follow within 24 h fails with `follow limit reached`, same for likes (Review Focus 2); follow creates one notice `'<name> followed you.'` with kind/actor; unfollow+refollow within 7 days creates no second notice; blocking deletes follows and likes both ways; `profile_social` counts exclude suspended and blocked-with-caller people and are zero for a profile the caller cannot see; `followers_of` of a third person hides people blocked by the caller; `member_directory` excludes self, unlisted, suspended and blocked, filters by level/area/stack (case-insensitive) and name with `%`/`_` taken literally, orders by level distance then name, pages of 30 (page −1 → first page, page 10 000 → empty) (Review Focus 3, 4); unlisted member still appears in `followers_of` and their profile row stays readable; `my_social_export` returns only the caller's ties.
- [ ] **Step 2: Run** `npx vitest run --project supabase --maxWorkers=2` → FAIL. **Step 3: Write 0006.** **Step 4: Run** → PASS; `npm run build:setup-sql`; drift + setup tests pass (table count updated). **Step 5: Commit** `feat(supabase): follows, likes, member list and social readers (0006)`.

---

### Task 3: Backend — SocialBackend methods (fake + Supabase)

**Files:** Modify `src/main/social/backend.ts`, `fake-backend.ts`, `supabase-backend.ts`, `errors.ts` · Test `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts`

**Interfaces — Produces:**
```ts
SocialBackend += {
  members(filters: MemberFilters, page: number): Promise<MemberRow[]>;
  profileOf(userId: string): Promise<SocialProfile | null>;      // null when not visible or gone
  socialStats(userId: string): Promise<SocialStats>;
  follow(userId: string): Promise<void>; unfollow(userId: string): Promise<void>;
  like(userId: string): Promise<void>;   unlike(userId: string): Promise<void>;
  followers(userId: string, page: number): Promise<MemberRow[]>; following(userId: string, page: number): Promise<MemberRow[]>;
}
Notice += { kind: NoticeKind; actor: { id: string; displayName: string } | null }
exportOwnData() += { social: <my_social_export()> }
FakeSocialOptions.seed += 'people'   // ~12 varied members, one unlisted, one suspended, one who blocked "Rian"; signed in as member Rian
```
`mapSupabaseError`: `/follow limit|like limit/` → `rate_limited`. Supabase: readers via `client.rpc(...)`, writes via `insert`/`delete` on the tables; `profileOf` reads `PROFILE_COLUMNS` (+ `listed`) by id; `listNotices` selects `kind, actor` and resolves actor names in one `profiles` query.

- [ ] **Step 1: Failing tests:** fake mirrors every Task 2 rule that the app relies on (self, blocked, suspended, limit, dedupe, hidden, ordering, paging); Supabase backend sends the right rpc names/params (`member_directory` with nulls for empty filters), maps `profile_social` rows, maps `follow limit reached` to `rate_limited`, export includes `social`.
- [ ] **Step 2: Run** `npx vitest run --project main --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): people methods in the social backends`.

---

### Task 4: IPC — channels and preload

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/social-handlers.ts`, `src/main/ipc/handle.ts`, `src/preload/api.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** channels `social:members {query?, level?, area?, stack?, page}` → `MemberRow[]`; `social:profileOf {userId}` → `SocialProfile | null`; `social:socialStats {userId}` → `SocialStats`; `social:follow|unfollow|like|unlike {userId}` → `null`; `social:followers|following {userId, page}` → `MemberRow[]`. `SocialNotice` += `kind`, `actor`. API: `social.members/profileOf/socialStats/follow/unfollow/like/unlike/followers/following`. Rate-limit copy: "You reached the limit of 200 follows a day. Try again tomorrow." / "…200 likes a day…".

- [ ] **Step 1: Failing tests:** each channel validates input (query of 41 chars, page −1 or 1.5, unknown level → `validation`); follow/like yourself → the exact self messages; the 201st follow → the follow limit copy; preload maps every method.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run --maxWorkers=2` + `npm run typecheck` → PASS. **Step 5: Commit** `feat(main): IPC for members, profiles, follows and likes`.

---

### Task 5: Renderer — routes, People tabs and the member list

**Files:** Modify `src/renderer/lib/router.ts`, `src/renderer/app/App.tsx`, `src/renderer/screens/PeopleScreen.tsx`, `screens.css`, `tests/e2e/fixtures.ts` (join lands on `#/people/me`) · Create `src/renderer/screens/MembersTab.tsx`, `src/renderer/design-system/MemberList.tsx` · Test `tests/renderer/router.test.ts`

**Interfaces — Produces:** `Route += { userId?: string; list?: 'followers' | 'following' }`; hashes `#/people` (Members), `#/people/following`, `#/people/me`, `#/people/edit`, `#/people/u/<uuid>`, `#/people/u/<uuid>/followers|following` (anything else under `u/` → Members); `<MemberList rows onOpen loading empty />` (ruled rows: Avatar/mascot 40, name, `memberLine`, main-stack `BadgeRow`); People tab bar (`role="tablist"`, links, `aria-current`).

- [ ] **Step 1: Failing tests:** router parses/round-trips every hash above; a non-uuid user id falls back to Members.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** Members (search field debounced 300 ms, level `Select`, area `Select`, stack field with known-stack datalist, "Load more", empty "No members match these filters.", loading skeleton, error notice with Try again); after Join/Save profile navigate to `#/people/me`; update existing e2e that expected `#/people` to show the own profile. **Step 4: Run** unit + `npx electron-vite build && npx playwright test tests/e2e/social-join.spec.ts tests/e2e/social-account.spec.ts` → PASS. **Step 5: Commit** `feat(renderer): People tabs and the member list`.

---

### Task 6: Renderer — other people's profiles, follow and like

**Files:** Create `src/renderer/screens/MemberProfile.tsx`, `src/renderer/design-system/SocialActions.tsx` · Modify `PeopleScreen.tsx` (share the profile view), `screens.css`, `components.css` · Test `tests/renderer/social.test.ts`

**Interfaces — Produces:** `<SocialActions userId stats self onChange />`: Follow/Following toggle (`aria-pressed`), ♥ like toggle with count (`aria-pressed`, label "Like Sam's profile, 12 likes"), "N followers" / "N following" links; optimistic update with rollback on failure; buttons disabled while a request is in flight. `applyFollow(stats, on)` / `applyLike(stats, on)` pure helpers. Profile not visible or gone → `EmptyState` "This profile is not available." with "Back to Members". Report and Block (existing components) on others' profiles; own profile shows the counts only.

- [ ] **Step 1: Failing tests:** `applyFollow`/`applyLike` never go below 0 and are idempotent; plural copy ("1 follower", "2 followers", "1 like").
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (+ typecheck). **Step 5: Commit** `feat(renderer): member profiles with follow and like`.

---

### Task 7: Renderer — lists, Following tab, notices, Edit profile, palette

**Files:** Create `src/renderer/screens/FollowList.tsx` · Modify `PeopleScreen.tsx`, `ProfileForm.tsx`, `App.tsx` (palette), `screens.css`

**Interfaces — Produces:** `#/people/u/<id>/followers|following` and the Following tab use `MemberList` with "Load more"; Following empty → "You do not follow anyone yet. Find people in Members."; follow notices render with the actor's avatar and a link to their profile, moderation notices unchanged; Edit profile checkbox "Show me in the member list" with hint "People who already follow you can still open your profile."; palette commands "Go to Members", "Go to Following".

- [ ] **Step 1: Failing e2e** (fake `people` seed) in `tests/e2e/people.spec.ts`: filter by level and open a profile; follow → count +1, Following tab lists them, the other account's notice exists in the fake state; unfollow → back; like/unlike count; followers list of a seeded member; turning off "Show me in the member list" hides you from another account's list (fake state check); the blocked seeded member is absent from lists and search; opening a suspended member's hash shows "This profile is not available." (Review Focus 5).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the spec → PASS. **Step 5: Commit** `feat(renderer): follower lists, Following, follow notices and listing switch`.

---

### Task 8: Documents — product, privacy, terms

**Files:** Modify `PRODUCT.md`, `docs/legal/privacy.md`, `docs/legal/terms.md`, `docs/legal/code-of-conduct.md` (version line), `src/core/social/types.ts` (`LEGAL_VERSION`), `tests/core/social.test.ts`, `README.md` (step 7: paste 0006)

- [ ] **Step 1: Failing test:** the core test pins the new `LEGAL_VERSION`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write** — PRODUCT.md: "no scoreboard" becomes "likes and followers are visible; no ranking"; privacy: follows, followers, likes given/received and the lists are visible to members, how to leave the member list, what export and deletion cover; terms: follow and like under "What you share". **Step 4: Run** → PASS. **Step 5: Commit** `docs: product and legal documents for following and likes`.

---

### Task 9: E2E, screenshots, design review, DESIGN.md

- [ ] **Step 1:** extend `tests/e2e/screenshots.spec.ts` with Members (filters set), another member's profile (followed, liked), a followers list and the Following tab, both themes × 1440/960; contact sheets; fix everything in one batch, recheck once; run the impeccable detector on the changed UI files.
- [ ] **Step 2:** a double-click on Follow and on ♥ ends in a consistent state (one request wins, counts right) — e2e (Review Focus 5).
- [ ] **Step 3:** impeccable finish reviewer (comp: the existing People profile + DESIGN.md), act on fixes; documenter extends DESIGN.md / `.impeccable/design.json` (member row, tabs, Follow/Like controls) without rewriting.
- [ ] **Step 4:** `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e` → PASS. **Step 5: Commit** `test: people end to end; docs(design): member list, tabs, follow and like`.

---

### Task 10: Go live (guided, after the final code review)

- [ ] Copy page in the agents view for `supabase/migrations/0006_people.sql`; the user pastes it alone in the SQL Editor ("Success. No rows returned").
- [ ] The user opens the app on the merged build, re-accepts the documents, sees Members, follows and likes a test account, and checks the notice on that account.
