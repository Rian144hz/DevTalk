# DevTalk Phase 1B (Design System + Screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved Galley Proof mockups into the working app: tokens and base components first, then Onboarding, Home, Practice, Feedback, Review, Progress, Settings, the Ctrl+K palette and shortcuts, verified by Playwright screenshots in both themes and two window sizes, plus README and an Ollama provider.

**Architecture:** The renderer is React 19 with plain CSS on design tokens (`src/renderer/design-system/tokens.css`, copied from the approved mockup tokens). Pure presentation logic (galley marking, sentence splitting, interval formatting, routing, theme resolution) lives in tested pure modules; screens talk to the main process only through `window.devtalk`. A few store/IPC additions feed the screens (stored feedback, the pending challenge, next due time). Playwright drives the built Electron app with the fixture LLM for e2e and screenshots.

**Tech Stack:** Electron 44, React 19, TypeScript 6, Vite 7, vitest 5, `@playwright/test` 1.64 (`_electron`), `@fontsource-variable/public-sans` 5.3.0 and `@fontsource-variable/jetbrains-mono` 5.3.0 (self-hosted, OFL).

**Spec:** `docs/superpowers/specs/2026-10-13-devtalk-phase1-design.md` (§9 screens, §10 visual, §12 tests). Visual authority: `docs/design/mockups/*.html` (approved 2026-10-14), `PRODUCT.md`, and the direction contract in `.impeccable/surfaces/src-renderer.md`.

## Global Constraints

- Exact new versions: `@playwright/test@1.64.0`, `@fontsource-variable/public-sans@5.3.0`, `@fontsource-variable/jetbrains-mono@5.3.0` (`--save-exact`). No UI component or CSS framework, no router library, no state library.
- Every colour, space, radius, font, duration comes from `tokens.css`; no hex values or px spacing literals in component CSS except 1px rules and icon sizes.
- Fonts are bundled (`@fontsource-variable/*` imports); the CSP stays `font-src 'self'`. No network requests from the renderer.
- Dark is the default theme; `theme: 'system' | 'dark' | 'light'` resolves to `data-theme="dark|light"` on `<html>`; `system` follows `prefers-color-scheme` live.
- Copy: plain English, sentence case, verbs on buttons; corrections are never called "wrong"/"errors" in UI copy (use "edits"). Explanations stay in the learner's explanation language as returned by the coach.
- No eyebrow/kicker labels above headings, no all-caps labels, no `'A · B'` meta strings, no `→` appended to links/buttons, no colored `border-left` > 1px, no shadows except floating layers (`--shadow-float`).
- The command palette and keyboard-triggered actions have no open/close animation. UI transitions use `--dur-*` and `--ease-out`; `prefers-reduced-motion` zeroes them.
- Keyboard: Ctrl+K palette; Ctrl+1…Ctrl+6 → Home, Practice, Review, Progress, Settings, Rooms; Ctrl+Enter submits an answer; Esc cancels a running coach request; in Review, Space reveals and 1–4 rate (ignore `KeyboardEvent.repeat`).
- Every screen has empty, loading and error states. LLM waits show stage + elapsed seconds + Cancel (Esc).
- WCAG AA: text ≥ 4.5:1 (large ≥ 3:1), visible `:focus-visible`, all features reachable by keyboard, labelled form controls, `role="status"`/`role="alert"` for async messages.
- Request ids: one `crypto.randomUUID()` per user action; the triggering control is disabled while its request runs (no double submit).
- Window: min 900×600; verify at 960×640 and 1440×900.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Coach edits that cannot be located in the learner's text** (paraphrased `original`, whole-answer `off_task`, overlapping spans, a span crossing a sentence end) — must still be shown, as general notes above the galley, never dropped or mis-highlighted. Tests in Task 1.
2. **Leaving a screen while the coach is still working** (navigate away, palette jump, window close) — the request is cancelled and no late result overwrites the new screen. Test in Task 7.
3. **No key / key rejected / rate limited / provider overloaded during a session** — the screen keeps the typed answer and shows the matching friendly message with the right next step (Settings link for key problems, Try again otherwise). Test in Task 8.
4. **Rapid repeated input** — Ctrl+Enter twice, a held 1–4 key in Review, double-clicking Write it — causes exactly one request/rating. Tests in Tasks 7 and 9.
5. **Very long content** — a 4000-character answer, a long situation, long expressions and explanations, long model names — wraps without horizontal overflow at 960 px. Test in Task 12.

---

### Task 1: Galley marking and sentence splitting (core)

**Files:**
- Modify: `src/core/domain/text.ts`, `src/core/domain/categories.ts`
- Create: `src/core/feedback/galley.ts`
- Test: `tests/core/galley.test.ts`, `tests/core/domain.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // text.ts
  splitSentences(text: string): { start: number; end: number }[]   // same rules as countSentences; spans cover the text incl. trailing space
  // categories.ts
  MISTAKE_LABELS: Record<MistakeCategory, string>                   // 'subject_verb_agreement' → 'subject–verb agreement', 'off_task' → 'off topic', others: underscores → spaces
  EXPRESSION_TYPE_LABELS: Record<ExpressionType, string>            // 'phrasal_verb' → 'phrasal verb'
  // galley.ts
  type GalleySegment = { kind: 'text' | 'del' | 'ins'; text: string } | { kind: 'mark'; n: number };
  interface GalleyNote { n: number | null; category: MistakeCategory; explanation: string }
  interface Galley { rows: { segments: GalleySegment[]; notes: GalleyNote[] }[]; general: GalleyNote[] }
  buildGalley(text: string, corrections: { original: string; corrected: string; explanation: string; category: MistakeCategory }[]): Galley
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('splitSentences keeps abbreviations and versions inside a sentence', () => {
  const t = 'We use e.g. Redis v1.2. It works!';
  expect(splitSentences(t).map((s) => t.slice(s.start, s.end).trim())).toEqual(['We use e.g. Redis v1.2.', 'It works!']);
});
test('marks an edit in place with its number and note', () => {
  const g = buildGalley('Yesterday I have worked on it. It works good.', [
    { original: 'have worked', corrected: 'worked', explanation: 'passado', category: 'verb_tense' },
    { original: 'good', corrected: 'well', explanation: 'advérbio', category: 'word_choice' },
  ]);
  expect(g.rows).toHaveLength(2);
  expect(g.rows[0]!.segments).toEqual([
    { kind: 'text', text: 'Yesterday I ' }, { kind: 'del', text: 'have worked' }, { kind: 'ins', text: 'worked' },
    { kind: 'mark', n: 1 }, { kind: 'text', text: ' on it. ' },
  ]);
  expect(g.rows[1]!.notes).toEqual([{ n: 2, category: 'word_choice', explanation: 'advérbio' }]);
  expect(g.general).toEqual([]);
});
test('falls back to a case-insensitive match', () => { /* original 'yesterday I' in 'Yesterday I went' → located */ });
test('unlocatable, whole-answer and overlapping edits become general notes', () => {
  // paraphrased original → general; off_task with original === whole text → general (n: null);
  // second edit overlapping the first → general; numbering stays 1..k for located edits only
});
test('an edit crossing a sentence end merges those sentences into one row', () => { /* 'It fails. Because the cache.' with original 'fails. Because' → 1 row */ });
test('a pure deletion has no ins segment', () => { /* corrected '' → del + mark only */ });
test('rows reproduce the original text when there are no edits', () => { /* concat of text segments === input */ });
```

- [ ] **Step 2: Run** `npm run test:core` → FAIL. **Step 3: Implement.** Locate each correction in order with a moving cursor (exact `indexOf` from the cursor, then from 0, then case-insensitive); reject empty originals, spans ≥ 80% of the text and spans overlapping an accepted span. Merge sentence spans crossed by an accepted span, then emit segments per row.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(core): galley marking and sentence spans`

---

### Task 2: Store reads for the screens

**Files:**
- Modify: `src/core/ports.ts`, `src/core/testing/memory-store.ts`, `src/main/db/sqlite-store.ts`, `tests/contract/study-store.contract.ts`
- Test: contract suite (runs in `tests/core/memory-store.test.ts` and `tests/main/sqlite-store.test.ts`)

**Interfaces:**
- Produces on `StudyStore`:
  ```ts
  interface StoredFeedback {
    feedbackId: number; attemptId: number; createdAt: string; text: string; challenge: Challenge | null;
    corrections: { original: string; corrected: string; explanation: string; category: MistakeCategory }[];  // saved order
    naturalRewrite: string; expressions: Expression[];                                                      // feedback_expressions order
    requiredChecks: { expression: Expression; used: boolean; usedCorrectly: boolean; note: string }[];
  }
  getFeedback(feedbackId: number): StoredFeedback | null;
  pendingChallenge(): Challenge | null;     // newest challenge that has no attempt yet
  nextDueAt(): Date | null;                 // earliest review_cards.due overall
  ```

- [ ] **Step 1: Add contract cases**: `getFeedback` round-trips everything `saveFeedback` stored, including the challenge and checks, and returns `null` for unknown ids; `pendingChallenge` returns the newest unanswered challenge and `null` once it has an attempt; `nextDueAt` is `null` with no cards and the earliest due otherwise.
- [ ] **Step 2: Run** `npm test` → FAIL in both stores. **Step 3: Implement** in both stores (SQLite: `ORDER BY position`; `pendingChallenge` via `NOT EXISTS (SELECT 1 FROM attempts WHERE challenge_id = c.id)`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat: store reads for feedback view, pending challenge and next due`

---

### Task 3: IPC additions

**Files:**
- Modify: `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/handlers.ts`, `src/preload/api.ts`
- Test: `tests/main/handlers.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `type FeedbackView = StoredFeedback` (re-exported from the contract).
  - `'feedback:submit'` now returns `FeedbackView` (handler reads `store.getFeedback(result.feedbackId)` after the engine finishes).
  - New `'feedback:get'` `{ feedbackId: number }` → `FeedbackView` (`not_found` when missing); API `feedback.get(feedbackId)`.
  - New `'challenges:pending'` `{}` → `Challenge | null`; API `challenges.pending()`.
  - `'review:queue'` returns `{ items: ReviewItem[]; nextDueAt: string | null }`.

- [ ] **Step 1: Write failing tests** (update the existing `review:queue` expectations to the new `{ items, nextDueAt }` shape): submit returns `text` and `challenge`; `feedback:get` round-trip and `not_found`; `challenges:pending` before/after an answer; `review:queue` reports `nextDueAt` when nothing is due; preload maps `feedback.get(7)` → `['feedback:get', { feedbackId: 7 }]` and `challenges.pending()` → `['challenges:pending', {}]`.
- [ ] **Step 2: Run** `npm run test:main` → FAIL. **Step 3: Implement** (add channels to `INVOKE_CHANNELS`). **Step 4: Run** `npm test` → PASS; `npm run typecheck` clean. **Step 5: Commit** — `feat(main): IPC reads for the screens`

---

### Task 4: Renderer foundation and e2e harness

**Files:**
- Create: `src/renderer/design-system/tokens.css` (copy of `docs/design/mockups/tokens.css`, fonts switched to the bundled family names), `src/renderer/design-system/base.css` (body, selection, scrollbars, focus ring, `.visually-hidden`, `.num`), `src/renderer/lib/router.ts`, `src/renderer/lib/theme.ts`, `src/renderer/lib/api.ts`, `src/renderer/lib/format.ts`, `src/renderer/app/App.tsx`, `src/renderer/app/Rail.tsx`, `src/renderer/app/routes.ts`, `src/renderer/env.d.ts` (`window.devtalk: DevtalkApi`), `playwright.config.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/smoke.spec.ts`
- Modify: `src/renderer/src/main.tsx` → `src/renderer/main.tsx` (update `index.html`), `vitest.config.ts` (add project `renderer`: `tests/renderer/**/*.test.ts`, node env), `package.json` (`"test:renderer"`, `"test:e2e": "electron-vite build && playwright test"`, `test` runs core+renderer+main), `.gitignore` (`test-results/`, `playwright-report/`, `.impeccable/review/`)
- Test: `tests/renderer/router.test.ts`, `tests/renderer/theme.test.ts`, `tests/renderer/format.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Route = { name: 'onboarding' | 'home' | 'practice' | 'feedback' | 'review' | 'progress' | 'settings' | 'people' | 'rooms' | 'components'; id?: number };
  parseHash(hash: string): Route;          // '#/feedback/12' → { name: 'feedback', id: 12 }; unknown → { name: 'home' }
  toHash(route: Route): string;
  useRoute(): [Route, (r: Route) => void]; // useSyncExternalStore on hashchange
  resolveTheme(setting: 'system' | 'dark' | 'light', prefersLight: boolean): 'dark' | 'light';
  useThemeEffect(setting): void;           // sets document.documentElement.dataset.theme, follows matchMedia when 'system'
  formatDueIn(from: Date, to: Date): string;     // 'now', 'in 10 min', 'in 3 h', 'tomorrow', 'in 4 days', 'in 2 months'
  formatRelativeDay(iso: string, now: Date): string;  // 'today', 'yesterday', '12 Oct'
  unwrap<T>(r: Result<T>): T;              // throws AppErrorException(kind, message)
  class AppErrorException extends Error { kind: AppErrorKind }
  newRequestId(): string;                  // crypto.randomUUID()
  ```
  `App` decides the first route: `profile.get()` null → onboarding. The `components` route exists only when `import.meta.env.DEV`.

- [ ] **Step 1: Install** `@fontsource-variable/public-sans@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0` and dev `@playwright/test@1.64.0` (exact). Do not run `playwright install` browsers: Electron is the browser.
- [ ] **Step 2: Write failing unit tests** for `parseHash`/`toHash` round-trip, `resolveTheme` (4 cases), `formatDueIn` boundaries (59 s → 'now', 10 min, 23 h → 'in 23 h', 1 day → 'tomorrow', 45 days → 'in 2 months'), `formatRelativeDay`. Run `npm run test:renderer` → FAIL; implement; → PASS.
- [ ] **Step 3: e2e harness.** `tests/e2e/fixtures.ts` exports a Playwright fixture `app` that launches `_electron.launch({ args: ['.'], env: { ...process.env, DEVTALK_FAKE_LLM: '1', DEVTALK_USER_DATA: <fresh tmp dir> } })`, yields `{ app, page }`, and `setSize(page, w, h)` via `app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s.w, s.h), …)`. First spec: `test('first launch shows onboarding', …)` expects heading "Set up your coach". Run `npm run test:e2e` → FAIL until App renders onboarding placeholder; then PASS.
- [ ] **Step 4: Shell.** `App` renders `Rail` (nav per the mockup: icon + label, Review due count, People "Later", footer "Coach: <provider label> (<model>)") and a placeholder per route. Verify `npm run dev` shows the rail in the dark theme.
- [ ] **Step 5: Commit** — `feat(renderer): tokens, theme, router and e2e harness`

---

### Task 5: Base components

**Files:**
- Create in `src/renderer/design-system/`: `Button.tsx`, `Kbd.tsx`, `Chip.tsx`, `TypeBadge.tsx`, `Galley.tsx`, `ExpressionCard.tsx`, `CoachProgress.tsx`, `Notice.tsx`, `EmptyState.tsx`, `Field.tsx` (TextField, PasswordField, Select, Segmented), `Skeleton.tsx`, `Tally.tsx`, `components.css`, `index.ts`; `src/renderer/screens/ComponentsScreen.tsx` (dev-only gallery: every component in every state, both themes via a toggle)
- Test: screenshot inspection of the dev-only gallery (Step 3); behaviour is covered by the screen e2e specs in Tasks 6–11

**Interfaces:**
- Produces (props are exact):
  ```ts
  Button({ variant: 'primary' | 'secondary' | 'quiet'; shortcut?: string; busy?: boolean; ...ButtonHTMLAttributes })
  Kbd({ children }) ; Chip({ children }) ; TypeBadge({ type: ExpressionType })
  Galley({ galley: Galley; title: string; meta?: ReactNode; head?: ReactNode })   // head replaces the title row (waiting/error states)
  ExpressionCard({ expression: Expression; foot?: ReactNode })                     // same layout everywhere
  CoachProgress({ stage: ProgressStage | null; startedAt: number; onCancel(): void; label: string })  // shows 'Sent / Reading / Checking', elapsed seconds, Cancel + Esc
  Notice({ tone: 'error' | 'info'; title: string; detail?: string; action?: ReactNode })  // role=alert for error
  EmptyState({ title: string; body: string; action?: ReactNode })
  TextField/PasswordField/Select({ label: string; hint?: string; error?: string; ... })  // visible label, aria-describedby
  Segmented<T extends string>({ label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void })  // radiogroup, arrow keys
  Tally({ count: number; label: string })   // pencil tally marks, groups of five, aria-label = label
  ```
  Visuals match `docs/design/mockups/app.css` (galley rows with 248px note column, collapsing to 200px under 1040px; del/ins washes; mark numbers; badge styles by type).

- [ ] **Step 1: Build components** from the mockup CSS, moving styles into `components.css` on tokens only.
- [ ] **Step 2: Gallery** at `#/components` (dev only) rendering each component in default, hover-able, focus, disabled, busy, error and empty variants, with real DevTalk content (the mockup texts).
- [ ] **Step 3: Verify by screenshot**: run `npm run dev`, open `#/components` in the built-in browser at 1440×900 and 960×640, dark and light; compare against the mockups; fix mismatches. Keyboard: Tab through the gallery and confirm every control shows the focus ring; Segmented moves with arrow keys.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → green. **Step 5: Commit** — `feat(renderer): base components`

---

### Task 6: Onboarding and Settings

**Files:**
- Create: `src/renderer/screens/OnboardingScreen.tsx`, `src/renderer/screens/SettingsScreen.tsx`, `src/renderer/screens/forms.ts` (shared option lists), `src/renderer/screens/screens.css`
- Test: `tests/e2e/onboarding.spec.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `profile.get/save`, `keys.status/set/clear(provider)`, `settings.get/set`, `DEFAULT_MODELS`, `PROVIDER_LABELS`, `LEVELS`.
- Produces: onboarding steps — (1) "Your languages": native language (Select: Portuguese (Brazil), Spanish, French, German, Italian, Japanese, Chinese, Korean, Russian, Other…), explanation language (Segmented: native / English); (2) "Your level": current (A2–C1), target (B1–C2, must be above current); (3) "Your coach": provider Segmented (Gemini — free, Claude, Ollama — on this computer), PasswordField for the key with a link "Get a free key" (Gemini: `https://aistudio.google.com/apikey`), privacy line "Your practice text is sent only to the coach you choose." Finish → `profile.save` + `keys.set` → Home.
- Settings sections: Profile (same fields), Coach (provider, model TextField defaulting to `DEFAULT_MODELS[provider]`, key status per provider with Set / Replace / Remove), Appearance (theme Segmented System/Dark/Light, applied immediately).

- [ ] **Step 1: Write failing e2e**: `onboarding saves profile and key, then lands on Home` (fills all steps, key `test-key`, expects heading "Today" and `keys.status('gemini')` true via `page.evaluate`); `target level must be above current` (error text, Continue disabled); `keyring unavailable shows the reason` is covered by handlers — skip in e2e. Settings: `changing theme applies immediately` (`<html data-theme>` flips), `removing the key shows the no-key notice on Practice`.
- [ ] **Step 2: Run** `npm run test:e2e` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(renderer): onboarding and settings`

---

### Task 7: Home and Practice

**Files:**
- Create: `src/renderer/screens/HomeScreen.tsx`, `src/renderer/screens/PracticeScreen.tsx`, `src/renderer/lib/useCoachRequest.ts`
- Modify: `src/main/llm/fake-fixtures.ts` (feedback edits that locate in the e2e answer: originals `have fixed` and `discuss about`)
- Test: `tests/e2e/practice.spec.ts`, `tests/renderer/coach-request.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // Runs one cancellable coach call; cancels on unmount and when a new call starts; ignores late results.
  useCoachRequest<T>(): {
    state: { status: 'idle' } | { status: 'running'; requestId: string; stage: ProgressStage | null; startedAt: number }
         | { status: 'done'; data: T } | { status: 'error'; error: AppErrorException };
    run(call: (requestId: string) => Promise<Result<T>>): void;
    cancel(): void;
  }
  createCoachRequestController(deps: { cancel(id: string): void; now(): number })  // pure core of the hook, unit-tested
  ```
- Home (mockup `home.html`): heading "Today" + lede built from due count and pending challenge; last answer galley from `progress.history({ before: null, limit: 1 })` → `feedback.get`; Next block = `challenges.pending()` with "Write it" (Enter) or, when none, "Get a challenge" running `challenges.next` with `CoachProgress`; right column = due list (first 6) + "Review now", and "Keeps coming back" tallies from `progress.summary().mistakes` (last 30 days, top 3). Empty first-run state: no last answer → EmptyState "Your first answer will appear here, marked by the coach."
- Practice: challenge header (track label from category, title from summary in sentence case, situation, interlocutor, task), required expressions with hints, `<textarea>` labelled "Your answer" with live sentence count ("3 sentences — aim for 3 to 5"), Submit "Get feedback" (Ctrl+Enter). Submitting navigates to `#/feedback` in Waiting state carrying the text; result replaces it; on error the text is preserved in Practice.

- [ ] **Step 1: Write failing unit tests** for `createCoachRequestController`: a second `run` cancels the first id; a result for a cancelled id is ignored; `cancel()` calls deps.cancel with the running id once. Run `npm run test:renderer` → FAIL; implement → PASS.
- [ ] **Step 2: Write failing e2e**: `get a challenge, answer it, see feedback` (fixture delay; asserts CoachProgress visible, then galley with 2 marks); `Ctrl+Enter twice saves one answer` (press twice quickly, wait for the result, assert `progress.history` via `page.evaluate` has exactly one item; `window.devtalk` is frozen by contextBridge, so count results, not calls); `leaving Practice while the coach works cancels it` (start, press Ctrl+1, assert Home and no navigation back to Feedback after the fixture delay); `answer longer than 4000 characters cannot be submitted` (counter turns to an inline message, button disabled).
- [ ] **Step 3: Implement.** **Step 4: Run** `npm run test:e2e` → PASS. **Step 5: Commit** — `feat(renderer): home and practice`

---

### Task 8: Feedback screen

**Files:**
- Create: `src/renderer/screens/FeedbackScreen.tsx`, `src/renderer/screens/errorCopy.ts`
- Test: `tests/e2e/feedback.spec.ts`, `tests/renderer/error-copy.test.ts`

**Interfaces:**
- Consumes: `FeedbackView`, `buildGalley`, `MISTAKE_LABELS`, `CoachProgress`, `ExpressionCard`.
- Produces: `errorAction(kind: AppErrorKind): 'settings' | 'retry' | 'none'` — `no_key`, `auth`, `config` → settings; `unavailable`, `rate_limited`, `invalid_output`, `truncated`, `refusal` → retry; `cancelled` → none.
- Layout per `feedback.html`: crumb, title, situation; galley "Your answer" with "{n} edits" (general notes listed in a block above the rows titled "About the whole answer"); "How a fluent developer might say it" (rewrite, new expressions underlined where they occur, Copy button); "New expressions" cards with foot "First review tomorrow" (from card due); right column "Required expressions" with Used well / Used, needs work / Not used yet + note; actions Next challenge (Enter) and Write it again. States: Waiting (CoachProgress over the plain answer, skeletons), Error (Notice with the friendly message, Try again or Open Settings, answer kept). Route `#/feedback/:id` renders a stored feedback read-only (from Progress history).

- [ ] **Step 1: Write failing tests**: unit `errorAction` table; e2e `rate limit keeps the answer and offers Try again` (fixture provider throws `rate_limited` when the answer contains `#ratelimit`; add that switch to `fake-fixtures.ts`), `no key sends you to Settings` (clear key via `page.evaluate`, submit, click "Open Settings"), `Copy puts the rewrite on the clipboard` (`app.evaluate(({ clipboard }) => clipboard.readText())`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(renderer): feedback screen`

---

### Task 9: Review screen

**Files:**
- Create: `src/renderer/screens/ReviewScreen.tsx`
- Test: `tests/e2e/review.spec.ts`

**Interfaces:**
- Consumes: `review.queue()` → `{ items, nextDueAt }`, `review.rate()`, `ExpressionCard`, `formatDueIn`.
- Produces: one card at a time, "{i} of {n}"; front shows phrase + TypeBadge; "Show meaning" (Space) reveals meaning and example; four rating buttons Again / Hard / Good / Easy (keys 1–4) each with its next interval (`formatDueIn(now, preview[rating])`); empty state "Nothing to review now" + "Next review {formatDueIn(now, nextDueAt)}" or, with no cards, "Expressions from your feedback will appear here."; done state after the last card with "Back to Today".

- [ ] **Step 1: Write failing e2e**: `rate a card with the keyboard` (Space, 3 → next card); `holding a rating key rates once` (dispatch one `keydown` for '3' then three with `repeat: true` via `page.evaluate`, assert the queue shrank by exactly one); `empty queue shows the next review time`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (ignore `event.repeat`; disable buttons while a rate call runs). **Step 4: Run** → PASS. **Step 5: Commit** — `feat(renderer): review screen`

---

### Task 10: Progress, People and Rooms

**Files:**
- Create: `src/renderer/screens/ProgressScreen.tsx`, `src/renderer/screens/LaterScreen.tsx`
- Test: `tests/e2e/progress.spec.ts`

**Interfaces:**
- Produces: Progress = three blocks: "Expressions" (total learned, reused correctly, due today — plain numbers in one sentence each, no stat cards), "Edits by category" (rows: label, `Tally` for last 30 days, total in small text), "History" (ruled list: date via `formatRelativeDay`, category track label or "Free text", first 90 characters of the answer, edit count; "Load more" with the `before` cursor; each row opens `#/feedback/:id`). People and Rooms render `LaterScreen` with EmptyState "Coming in a later version" and one sentence on what it will do (People: practise with other developers; Rooms: scheduled voice rooms with timed turns).

- [ ] **Step 1: Write failing e2e**: `history opens a past feedback`; `progress shows edits by category after one answer`; `Rooms explains it is coming later`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(renderer): progress and later screens`

---

### Task 11: Command palette and shortcuts

**Files:**
- Create: `src/renderer/app/CommandPalette.tsx`, `src/renderer/lib/commands.ts`, `src/renderer/app/useShortcuts.ts`
- Test: `tests/renderer/commands.test.ts`, `tests/e2e/palette.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Command { id: string; label: string; keywords: string[]; shortcut?: string; run(): void }
  filterCommands(commands: Command[], query: string): Command[]   // case-insensitive subsequence over label+keywords, label-prefix matches first
  ```
  Commands: Go to Today/Practice/Review/Progress/Settings/Rooms, Get a new challenge, Start review, Switch to dark theme / light theme / system theme. The palette is a `<dialog>` opened with Ctrl+K (also from the rail's search button), listbox with `aria-activedescendant`, ↑/↓/Enter/Esc, focus returns to the opener on close, no animation.

- [ ] **Step 1: Write failing tests**: unit `filterCommands` ('rev' → Start review and Go to Review first; '' → all in declared order); e2e `Ctrl+K then "set" Enter opens Settings`, `Ctrl+3 opens Review`, `Esc closes the palette and restores focus`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `feat(renderer): command palette and shortcuts`

---

### Task 12: Screenshot verification, fixes and README

**Files:**
- Create: `tests/e2e/screenshots.spec.ts`, `README.md`
- Modify: whatever the screenshots show is wrong

**Interfaces:**
- Produces: `screenshots.spec.ts` seeds a session through the fixture LLM (onboarding, one challenge, one answer, one review) and captures every screen — Onboarding, Home, Practice, Feedback (ready, waiting, error), Review (card, empty), Progress, Settings, Rooms, palette open — in {dark, light} × {960×640, 1440×900} into `.impeccable/review/<screen>-<theme>-<w>.png`, plus `desktop.png` (Home, 1440, dark) and `mobile.png` (Home, 960, dark) for the finish reviewer. Also `long content does not overflow` (4000-char answer, long expression and model name: assert `document.documentElement.scrollWidth <= innerWidth` on Practice, Feedback, Settings at 960).

- [ ] **Step 1: Write the spec and run it** → captures land; the overflow test may FAIL first.
- [ ] **Step 2: Inspect every capture once** (batched) against the mockups, the craft floor and the Global Constraints; fix all findings in one batch; rerun; inspect a second (final) time.
- [ ] **Step 3: Run the detector once** on the changed UI: `impeccable detect --json src/renderer`; fix mechanical findings.
- [ ] **Step 4: README** (English): what DevTalk is; requirements (Node ≥ 22, Linux keyring such as GNOME Keyring or KWallet); install (`npm install`, the npm 11 `allowScripts` approvals, Electron binary download); getting a free Gemini key and entering it in onboarding (or `npm run cli -- --set-key --provider gemini`); `npm run dev`; tests (`npm test`, `npm run test:e2e`); fixture mode (`DEVTALK_FAKE_LLM=1`); where data lives; editing `prompts/`; mockups (`docs/design/mockups`, served by the `mockups` launch config).
- [ ] **Step 5: Run** `npm test && npm run test:e2e && npm run typecheck` → green. **Step 6: Commit** — `test(e2e): screenshot round, fixes and README`

---

### Task 13: Ollama provider

**Files:**
- Create: `src/main/llm/ollama-provider.ts`
- Modify: `src/main/app-context.ts`, `src/renderer/screens/SettingsScreen.tsx` (Ollama needs no key: show base URL `http://127.0.0.1:11434` read-only and a "Check connection" button), `src/main/ipc/handlers.ts` + contract (`'llm:check'` `{}` → `{ ok: boolean; detail: string }` that lists local models via the provider)
- Test: `tests/main/ollama-provider.test.ts`

**Interfaces:**
- Produces: `createOllamaProvider(opts: { model: string; baseUrl?: string; fetch?: typeof fetch }): LLMProvider` — POST `${baseUrl}/api/chat` with `{ model, stream: false, format: <zod JSON schema without $schema>, messages: [{ role: 'system', content }, { role: 'user', content }], options: { temperature: 0.4 } }` and the abort signal; returns `message.content`. Errors: connection refused → `unavailable` with detail "Ollama is not running"; 404 → `config` ("Model not found. Run: ollama pull <model>"); abort → `cancelled`. `makeProvider` no longer needs a key for `ollama`.

- [ ] **Step 1: Write failing tests** with an injected `fetch`: request body shape and signal; content returned; refused connection, 404, abort mappings.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS. **Step 5: Commit** — `feat(main): Ollama provider`

---

### Task 14: Finish review and DESIGN.md

**Files:**
- Create: `DESIGN.md`, `.impeccable/design.json` (by the documenter)

- [ ] **Step 1: Finish review.** Spawn the impeccable finish reviewer (fresh context) with: the original brief's visual section, the confirmed answers (dark default, Galley Proof chosen, Gemini default), `src/renderer` as the artifact, the screenshot paths from Task 12 (all required), the direction contract (`.impeccable/surfaces/src-renderer.md`), detector findings, the chosen decision sketch `.impeccable/mocks/decision/model-pick.html` and the approved mockups as critique references, and the craft-floor reference path. Act on its disposition (fix batch → recapture → verdict pass; at most two rounds).
- [ ] **Step 2: Document.** Spawn the impeccable documenter with the project root, `src/renderer`, the direction contract and `PRODUCT.md`; verify `DESIGN.md` and `.impeccable/design.json` carry the tokens.
- [ ] **Step 3: Run** `npm test && npm run test:e2e && npm run typecheck` → green. **Step 4: Commit** — `docs(design): finish review and DESIGN.md`
