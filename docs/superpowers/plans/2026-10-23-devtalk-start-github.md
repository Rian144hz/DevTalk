# DevTalk Start Screen and GitHub Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app opens with a short animated brand screen every time; first-time users get a welcome screen to continue with GitHub, with e-mail or without an account; GitHub sign-in uses the system browser and a loopback redirect, and suggests the profile's name and photo.

**Architecture:** The main process keeps Supabase: PKCE OAuth with `skipBrowserRedirect`, a one-shot loopback HTTP listener on 127.0.0.1 (ports 53682–53684), `shell.openExternal` limited to the project's https origin, and a GitHub suggestion (name + avatar bytes from avatars.githubusercontent.com). The renderer adds a splash overlay, a first-run flow (welcome → sign-in → existing join steps → existing coach onboarding) and the GitHub button in Join. No database change.

**Tech Stack:** unchanged (Electron 44, React 19, TS 6, zod 4, supabase-js 2.117.3, vitest, Playwright). Node `http` for the listener. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-devtalk-start-github-design.md` · Visual authority: `DESIGN.md` + `.impeccable/design.json`.

## Global Constraints

- Supabase stays in the main process only; only the publishable key in the app; the GitHub Client Secret lives only in the Supabase dashboard (never in the app, the repo or chat).
- Loopback: bind `127.0.0.1` only; ports 53682, 53683, 53684 (first free); path `/callback`; one accepted callback, then close; 5-minute timeout; Cancel and app quit close it.
- `shell.openExternal` only for an `https:` URL whose origin equals the configured Supabase URL's origin.
- OAuth: `provider: 'github'`, `scopes: 'read:user user:email'`, `flowType: 'pkce'`, `exchangeCodeForSession(code)`.
- GitHub avatar: download only from `https://avatars.githubusercontent.com/`, at most 2 MB, then the existing avatar preparation (WebP, metadata removed) before upload; nothing is saved until the member saves the profile.
- Splash: every launch; ~1.5 s; click, Enter, Space or Esc skips; `prefers-reduced-motion: reduce` → static name for 0.3 s; never waits for the network.
- First run = no local coach profile (`profile:get` → null). Already set up → splash → Home.
- GitHub logo: Simple Icons (CC0), in the text colour.
- New `LEGAL_VERSION` = implementation date (suffix `.N` if that date was already used; 2026-10-20 is taken).
- Unit tests always with `--maxWorkers=2`. Copy in simple English (B1). Do not update the agents view. Branch `feat/start-github` (check `git branch --show-current` before every commit). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Forged or stray callbacks** — another local process or a web page calling `http://127.0.0.1:5368x/callback` with a made-up code or error, or any other path: no crash, no sign-in (PKCE), other paths 404 without ending the wait, the listener closed after the first `/callback`. Tests in Task 1.
2. **Abandoned browser** — the member closes the tab: after 5 minutes (or Cancel) the ports are free and a new attempt works; a second "Continue with GitHub" while one waits cancels the first. Tests in Tasks 1 and 2.
3. **Busy ports** — 53682 taken → 53683; all three taken → "Could not start GitHub sign-in. Close other apps that use ports 53682–53684 and try again." Tests in Task 1.
4. **Splash never blocks** — slow or failing data load, offline, reduced motion, skip keys; the next screen shows as soon as both the splash and the data are done. Tests in Task 3.
5. **First-run edges** — community not configured (only "Practise without an account"), a GitHub user who already accepted the documents and has a profile (skip to coach), a sign-in error message shown on the welcome screen. Tests in Task 4.

---

### Task 1: Main — GitHub OAuth (loopback listener, backends)

**Files:** Create `src/main/social/oauth-loopback.ts` · Modify `src/main/social/backend.ts`, `fake-backend.ts`, `supabase-backend.ts`, `src/main/security.ts` · Test `tests/main/oauth-loopback.test.ts`, `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts`, `tests/main/security.test.ts`

**Interfaces — Produces:**
```ts
// oauth-loopback.ts
const OAUTH_PORTS = [53682, 53683, 53684] as const; const OAUTH_TIMEOUT_MS = 300_000;
type LoopbackResult = { code: string } | { error: string }
openLoopback(o?: { ports?: readonly number[]; timeoutMs?: number; signal?: AbortSignal }):
  Promise<{ redirectTo: string; result: Promise<LoopbackResult>; close(): void }>   // rejects 'ports busy' when none is free
// security.ts
isAllowedAuthUrl(url: string, supabaseUrl: string): boolean   // https + same origin
// SocialBackend +=
signInWithGitHub(o: { openExternal(url: string): Promise<void>; signal?: AbortSignal }): Promise<SocialSession>;
githubSuggestion(): Promise<{ displayName: string | null; avatar: Uint8Array | null; avatarType: string | null }>;   // nulls when the session is not a GitHub identity
// FakeSocialBackend: signInWithGitHub signs in at once as "octo@example.com" (display name suggestion "Octo Dev", a small bundled PNG avatar); fail injection via `fail.signInWithGitHub`
```
Errors (SocialError): `'cancelled'` kind for Cancel/timeout is NOT added — use `unknown` with messages "Sign-in was not finished. Try again." (timeout/cancel/browser error) and "Could not start GitHub sign-in. Close other apps that use ports 53682–53684 and try again." (ports busy).

- [ ] **Step 1: Failing tests:** loopback — picks 53682, or 53683 when 53682 is busy, rejects when all are busy; `/callback?code=abc` resolves `{code:'abc'}` and answers a small HTML page containing "You can go back to DevTalk."; `/callback?error=access_denied&error_description=...` resolves `{error}`; `/other` → 404 and the wait continues; a second `/callback` after the first is refused (listener closed); timeout and `signal.abort()` resolve `{error:'Sign-in was not finished. Try again.'}` and free the port; binds only 127.0.0.1 (Review Focus 1–3). `isAllowedAuthUrl` accepts `https://xjyp.supabase.co/auth/v1/authorize?...` for that project and refuses http, other hosts, look-alike hosts. Supabase backend: client uses `flowType: 'pkce'`; `signInWithGitHub` calls `/auth/v1/authorize` url with `provider=github`, `redirect_to=http://127.0.0.1:<port>/callback`, scopes, opens it only through `openExternal`, refuses a non-matching URL, exchanges the code (`POST /auth/v1/token?grant_type=pkce`) and returns the session; an `{error}` result throws the not-finished message. `githubSuggestion` maps `user_metadata.full_name|name` and downloads `avatar_url` only from avatars.githubusercontent.com (≤ 2 MB; other hosts → null). Fake parity.
- [ ] **Step 2: Run** `npx vitest run --project main --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS + typecheck. **Step 5: Commit** `feat(main): GitHub sign-in through the browser and a loopback listener`.

---

### Task 2: Main — IPC and wiring

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/social-handlers.ts`, `src/main/app-context.ts`, `src/main/index.ts`, `src/preload/api.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** channels `social:signInWithGitHub {}` → `SocialStatus` (resolves when signed in), `social:cancelSignIn {}` → null, `social:githubSuggestion {}` → `{ displayName: string | null; avatarDataUrl: string | null }`; API `social.signInWithGitHub()`, `social.cancelSignIn()`, `social.githubSuggestion()`. Handlers keep one in-flight attempt (AbortController); a new attempt aborts the old one; `onSessionChange` runs after success; app-context passes `openExternal = (url) => isAllowedAuthUrl(url, config.url) ? shell.openExternal(url) : reject`; after success main focuses/restores the window; `before-quit` aborts an attempt.

- [ ] **Step 1: Failing tests:** sign-in through the fake returns a signed-in status and calls onSessionChange; a second call aborts the first (first resolves with the not-finished error); cancel resolves the waiting call with that error; suggestion maps bytes to a `data:<type>;base64,…` URL and null when absent; preload maps the three methods (Review Focus 2).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run --maxWorkers=2` + typecheck → PASS. **Step 5: Commit** `feat(main): GitHub sign-in channels`.

---

### Task 3: Renderer — animated splash

**Files:** Create `src/renderer/app/Splash.tsx`, `src/renderer/lib/splash.ts` · Modify `src/renderer/app/App.tsx`, `src/renderer/app/app.css` · Test `tests/renderer/splash.test.ts`, `tests/e2e/start.spec.ts`

**Interfaces — Produces:** `splashTiming(reducedMotion: boolean): { showMs: number; fadeMs: number }` (1 500/250 normal; 300/0 reduced); `<Splash onDone()>` — full-window overlay on the theme ground: an SVG where "DevTalk" (Public Sans, large) is revealed left to right while the pencil mark follows, then one letter gets the rose strike and the sage correction above it (galley marks), then fades; `role="img"` with `aria-label="DevTalk"`; click/Enter/Space/Esc call onDone at once. App shows the splash on every launch and renders the next screen when both the splash is done and the app data has loaded (data failures still end the splash).

- [ ] **Step 1: Failing tests:** `splashTiming` values; e2e — the splash is visible right after launch, disappears by itself, a click skips it, `emulateMedia({ reducedMotion: 'reduce' })` shows the static name briefly; already set-up app lands on Today after the splash (Review Focus 4).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (CSS animations with the motion tokens; no JS timers beyond onDone). **Step 4: Run** unit + `npx electron-vite build && npx playwright test tests/e2e/start.spec.ts` → PASS. **Step 5: Commit** `feat(renderer): animated splash on every launch`.

---

### Task 4: Renderer — welcome screen, first-run flow, GitHub in Join, profile suggestion

**Files:** Create `src/renderer/screens/WelcomeScreen.tsx`, `src/renderer/lib/first-run.ts` · Modify `src/renderer/app/App.tsx`, `src/renderer/screens/JoinScreen.tsx`, `src/renderer/screens/OnboardingScreen.tsx` (only if a hook is needed), `src/renderer/lib/stack-icons*.ts` or icons for the GitHub mark, CSS in `screens.css` · Test `tests/renderer/first-run.test.ts`, `tests/e2e/start.spec.ts`

**Interfaces — Produces:** `firstRunStep(s: { configured: boolean; signedIn: boolean; needsDocuments: boolean; hasProfile: boolean }, choice: 'none' | 'github' | 'email' | 'local', coachDone: boolean): 'welcome' | 'join' | 'coach' | 'done'`; WelcomeScreen (spec §2/§4 copy; GitHub button primary with the GitHub mark; e-mail secondary; "Practise without an account" quiet; only the last when not configured; "Finish signing in in your browser." + Cancel while waiting; error notice); JoinScreen gains **Continue with GitHub** in step 1 and an embedded mode used by the first-run flow (`onDone`), and prefills the profile step from `social.githubSuggestion()` (display name; avatar converted with the existing avatar preparation; "From your GitHub account" note; Remove photo).

- [ ] **Step 1: Failing tests:** `firstRunStep` table (not configured → welcome shows only local; github signed-in + needs docs → join; signed-in with docs and profile → coach; local choice → coach; coach done → done) (Review Focus 5); e2e with the fake community (`social: '1'`): splash → welcome → Continue with GitHub → rules → profile prefilled "Octo Dev" with a photo → coach setup → Today; e-mail path reaches the code step; "Practise without an account" → coach → Today; Join step 1 shows Continue with GitHub; an injected GitHub failure shows the error on the welcome screen.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** unit + the start spec + existing onboarding/social-join specs → PASS. **Step 5: Commit** `feat(renderer): welcome screen, first-run flow and GitHub sign-in`.

---

### Task 5: Documents — privacy, terms, README setup

**Files:** `docs/legal/privacy.md`, `docs/legal/terms.md`, `docs/legal/code-of-conduct.md` (version line), `src/core/social/types.ts` (`LEGAL_VERSION`), `tests/core/social.test.ts`, `README.md`

- [ ] **Step 1: Failing test:** the core test pins the new `LEGAL_VERSION`. **Step 2: Run** → FAIL. **Step 3: Write** (signing in with GitHub; what GitHub sends: name, username, photo, e-mail; what is kept: e-mail on the account, name and photo only if kept on the profile; the code comes back through a local address on your computer; same e-mail joins accounts) and a README "GitHub sign-in" setup section (GitHub OAuth App with the Supabase callback; Client ID/Secret only in Supabase › Authentication › Providers › GitHub; the three redirect URLs in URL Configuration). **Step 4: Run** → PASS. **Step 5: Commit** `docs: GitHub sign-in in privacy, terms and setup`.

---

### Task 6: E2E, screenshots, design review, DESIGN.md

- [ ] **Step 1:** screenshots of the splash (mid-animation and end), the welcome screen (configured and not configured), the waiting state, and the prefilled profile step, both themes × 1440/960; contact sheets; fix in one batch; recheck once; impeccable detector.
- [ ] **Step 2:** impeccable finish reviewer (controller), fixes; documenter extends DESIGN.md / design.json (splash, welcome).
- [ ] **Step 3:** `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e` → PASS. **Step 4: Commit** `test: start screen end to end; docs(design): splash and welcome`.

---

### Task 7: Go live (guided, after the final code review)

- [ ] A local page with the GitHub OAuth App and Supabase provider steps (the owner types the secret only in the Supabase dashboard).
- [ ] The owner re-accepts the documents and tests: splash, welcome, Continue with GitHub in the real browser, back to the app, profile prefilled.
