# Sky-blue colours and pill buttons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle DevTalk with the sky-blue palette in both themes and pill buttons with hover/press motion, without touching layout, copy or fonts.

**Architecture:** Every colour already flows from `src/renderer/design-system/tokens.css`. The work is therefore:
1. Split the dual-use `--pencil` into a button fill (`--accent*`) and a text/mark colour (`--pencil`), then swap the values in both themes. A contrast unit test guards the change.
2. Restyle `.btn` in `components.css`.

**Tech Stack:** Electron + React 19, plain CSS tokens, vitest, Playwright for Electron.

**Spec:** docs/superpowers/specs/2026-10-27-devtalk-restyle-sky-design.md

## Global Constraints

- Change only colours (everywhere) and button shape/motion. Layout, spacing, fonts, copy, card radii and icons stay as they are.
- Use the palette values from spec §2. If one fails the §4 contrast test, change it as little as possible and record the change as a ruling.
- Shadows: none, except the existing `--shadow-float` for floating layers (now navy-tinted).
- `prefers-reduced-motion: reduce` → no transform on buttons; only colour changes.
- Run unit tests ALWAYS as `npx vitest run --maxWorkers=2`. Run e2e as `npx electron-vite build && npx playwright test` (1 worker). Typecheck with `npm run typecheck`.
- Do not use AbacatePay code, fonts, logos or assets.
- Branch `feat/restyle-sky`. Check `git branch --show-current` before every commit. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Text on the new grounds:** ink-3 hints, links, diff marks and warnings must stay readable on `--bg`, `--sheet` and `--sheet-hover` in both themes. Covered by the Task 1 contrast test.
2. **Every former `--pencil` fill:** any place that used `--pencil` as a fill with `--pencil-ink` on top (not only `.btn-primary`) must move to `--accent`/`--on-accent`, or it keeps white text on sky blue. Task 1 greps for these.
3. **Buttons that are not `<Button>`:** `a.btn` links, `.btn` with extra classes (`.wide`, chat small buttons, welcome full-width) keep their size rules and still read as pills. Task 2 screenshots.
4. **Leading icon stays still:** GitHub mark, busy dot and Kbd shortcut must not move on hover; only a trailing svg moves. Task 2 e2e.
5. **Disabled/busy buttons:** no lift on hover. Task 2 e2e.

---

### Task 1: Tokens, palette and contrast test

**Files:**
- Modify: `src/renderer/design-system/tokens.css` (both theme blocks; new `--accent`, `--accent-hover`, `--on-accent`, `--r-pill`; remove `--pencil-ink`)
- Modify: `src/renderer/design-system/components.css`, and every `--pencil-ink` / `--pencil`-as-fill use (find them with `grep -rn "pencil-ink\|background: var(--pencil)" src/renderer`)
- Modify: `src/renderer/lib/stack-icons.ts` (`THEME_GROUNDS`, `NEUTRAL`)
- Modify: `tests/e2e/start.spec.ts:87,107` (light splash ground `rgb(245, 249, 255)`)
- Test: `tests/renderer/colour.test.ts`

**Interfaces:**
- Produces: tokens `--accent`, `--accent-hover`, `--on-accent` (button fill pair), `--pencil` (text/marks only), `--r-pill: 999px`. Task 2 consumes them.

- [ ] **Step 1:** Write the test `test('text tokens pass AA on every ground of both themes', …)` in `colour.test.ts`.
  - Parse both theme blocks the way the existing badge test does.
  - Composite the rgba washes over `--sheet` (alpha blend) before measuring.
  - Assert every pair in spec §4: 4.5 for text, 3 for `--focus`.
  - Also assert that `--pencil-ink` no longer exists and that `--accent`, `--accent-hover` and `--on-accent` exist in both blocks.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/colour.test.ts`. Expected: FAIL (`--accent` missing).
- [ ] **Step 3:** Apply the §2 palette to both blocks, add the new tokens and move every `--pencil` fill to `--accent`/`--on-accent`:
  - `.btn-primary`, including its `kbd` rule;
  - any other filled pencil surface that carries text. A thin bar like `.coach-bar i` or the splash pen may keep `--pencil`.

  Also:
  - Point `--shadow-float` at navy `rgb(11 42 79 / …)`.
  - Mirror the new `--bg`, `--sheet` and `--ink-2` values in `stack-icons.ts`.
  - Update the two splash-ground assertions in `start.spec.ts`.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(design): sky-blue palette in both themes`.

### Task 2: Pill buttons and their motion

**Files:**
- Modify: `src/renderer/design-system/components.css:4-14` (`.btn*`)
- Test: `tests/e2e/buttons.spec.ts` (new)

**Interfaces:**
- Consumes: `--accent`, `--accent-hover`, `--on-accent`, `--pencil-wash`, `--r-pill`, `--ease-out` (Task 1).

- [ ] **Step 1:** Write `tests/e2e/buttons.spec.ts`, using the fixtures from `tests/e2e/fixtures.ts`:
  - `primary buttons are pills that lift on hover`: on the welcome screen, `.btn-primary` has `border-radius` ≥ its height / 2. After hover, the computed `transform` is a matrix with ty = -1 (allow for the transition: wait or poll).
  - `a leading icon stays still, a trailing one moves`: the GitHub button's svg has transform `none` after hover. Inject a test button with a trailing svg, or use a real one if a screen has it; its svg `translate` is `4px` after hover.
  - `disabled buttons do not lift`.
  - `with reduced motion buttons never move`: `page.emulateMedia({ reducedMotion: 'reduce' })`, hover a primary, computed transform is `none`.
- [ ] **Step 2:** Run `npx electron-vite build && npx playwright test tests/e2e/buttons.spec.ts`. Expected: FAIL (radius 6px, no lift).
- [ ] **Step 3:** Restyle `.btn` per spec §3:
  - `border-radius: var(--r-pill)`, padding `9px 18px`.
  - Transitions: background-color and transform 200ms; `.btn > svg:last-child:not(:first-child)` gets `translate` 300ms `var(--ease-out)` and moves 4px on `.btn:hover:not([disabled])`.
  - Primary: `--accent`, hover `--accent-hover` + `translateY(-1px)`.
  - Secondary: `--sheet` with a 1px `--rule-strong` border, hover `--sheet-hover` + lift.
  - Quiet: hover `--pencil-wash` and `--ink`, no lift.
  - Active: `scale(0.98)`.
  - Disabled/busy: no hover change.
  - Reduced motion: `.btn, .btn > svg { transform: none !important; translate: none !important; }`.
  - Leave the existing size overrides (`screens.css` `.btn` rules) intact unless one breaks the pill. Record any change.
- [ ] **Step 4:** Run the buttons spec, then `npx vitest run --maxWorkers=2 && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(design): pill buttons with lift, press and arrow nudge`.

### Task 3: Screenshots, design review, DESIGN.md, full suites

- [ ] **Step 1:** Run `npx playwright test tests/e2e/screenshots.spec.ts` (the whole capture set, both themes × 1440/960). Build contact sheets with `.superpowers/sdd/<workspace>/sheet.py`. Fix what is broken in ONE batch. Recheck once. Run the impeccable detector on `tokens.css`, `components.css`, `base.css`, `app.css` and `screens.css`.
- [ ] **Step 2 (controller):** Dispatch the impeccable finish reviewer, apply its fixes, then have the documenter rewrite the DESIGN.md / design.json colour and button sections for the sky palette and pill buttons.
- [ ] **Step 3:** Run `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e`. Expected: PASS (known flakes: screenshots "coach states", moderation "warning closes one"; rerun once).
- [ ] **Step 4:** Commit `test: screenshots after the sky restyle` (and the fixes).
