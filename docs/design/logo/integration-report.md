# Integration report: the pencil duck in the app

Branch `feat/logo-in-app`, from `main` 68fae3e. Nothing was pushed. Security settings (contextIsolation, sandbox,
nodeIntegration, the CSP, `allowPermission`) are untouched: `src/main/security.ts` has no change, and the window keeps
`secureWebPreferences` on every platform.

## What changed, by file

**1. `a6426be` feat(design): duck mark and brand line**
- `src/renderer/design-system/tokens.css`: `--logo-duck`, `--logo-beak`, `--logo-lead` in both theme blocks (dark `#8ec5ff`
  `#ffa23f` `#e6eef9`, light `#2f7de1` `#ffa23f` `#0b2a4f`).
- `design-system/duck.ts` (new): the kit's path data, full and small, in paint order (bill, lead, hull, head).
- `design-system/DuckMark.tsx` (new): inline SVG, `viewBox 0 0 256 256`, props `variant` and `size`, `aria-hidden`, fills
  through classes (`duck-bill`, `duck-lead`, `duck-hull`, `duck-head`) that read the tokens in `components.css`.
- `design-system/Brand.tsx` (new): the small duck at 24 px plus "DevTalk" as text. Used in `app/Rail.tsx`,
  `screens/WelcomeScreen.tsx`, `OnboardingScreen.tsx` and `JoinScreen.tsx`. `app/app.css`: `.brand` gap 4 px and
  `.brand .duck-mark { translate: 0 -1px }`. `design-system/index.ts` exports both. `ComponentsScreen.tsx` (dev gallery) shows them.

**2. `36a8e07` feat(renderer): the duck writes the name in the splash**
- `lib/lockup.ts` (new): the official lockup's geometry at the splash's type size, and both viewBoxes.
- `app/Splash.tsx`, `app/app.css`: the full duck at the left, slide-in, wipe from the bill tip, correction marks unchanged.
  Pencil, `splash-travel` and `PEN_GAP` removed. `app/icons.tsx`: the now unused `pencil` icon removed.

**3. `cc24286` feat: app icon and favicon**
- `build/icon.png` (kit icon-1024), `electron-builder.yml` (`buildResources: build`, `linux.icon: build/icon.png`, `files` as before).
- `src/main/window.ts` (new, `mainWindowOptions`), `src/main/index.ts`, `src/main/env.d.ts`: Linux window icon.
- `src/renderer/public/favicon.svg` (kit copy) and the `<link rel="icon" href="./favicon.svg">` in `index.html`.

**4. `250f15a` docs(design)**: `DESIGN.md` (brand line, logo colours, Splash section, Logo section, splash width 5.8 units).

**5. `adad81f` docs**: `README.md` (picture, Screenshots), `docs/screenshots/{feedback-light,chat-dark,room-light,profile-dark}.png`,
all of `docs/design/logo/**` (101 files), and a tall profile capture in `tests/e2e/screenshots.spec.ts`.

**6. `edf8395` test and `757d98e` docs(design)**: two small corrections (a test title, a comment).

The report itself is the last commit, so its own hash is not listed.

Tests added or changed: `tests/renderer/{colour,logo,lockup}.test.ts`, `tests/main/{window,app-icon,security}.test.ts`,
`tests/e2e/{logo,start,screenshots}.spec.ts`.

## Where I departed from the brief

- **Window icon comes from `build/icon.png`, not `resources/`.** electron-vite treats `resources/` as its public folder:
  `?asset` there is not copied to `out/` and resolves to `app.asar/resources/icon.png`, which `files: out/**` does not ship.
  Importing `build/icon.png?asset` makes electron-vite emit `out/main/chunks/icon-<hash>.png`; `files` stays as it was and
  there is one icon file instead of two.
- **The splash name is untracked** (`letter-spacing: 0`, was -0.01em), because the logo's wordmark is. Without it the last
  letter sat 7 units off the official lockup. The correction marks did not move (the "d" glyph does not depend on tracking).
- **"0.46 cap heights" is the distance to the first letter's origin** (the generator's `gap = 34` on a cap of 74). The
  visible distance to the ink of a capital "D" is 0.57, as in the kit file.
- One `DuckMark` serves both themes, with the light symbol's geometry. The kit's "on dark" file differs by 0.5 unit (eye
  radius 10 against 9.5, bill base). That is 0.2 % of the box, invisible at any size used here.

## RED to GREEN

| Test | Before | After |
|---|---|---|
| `colour.test.ts` logo tokens (3:1 on `--bg`, `--bg-rail`, `--sheet`, and equal to the kit's colours) | 4 failed ("--logo-duck: expected null not to be null") | 29 passed in `colour` + `logo` |
| `logo.test.ts` (DuckMark paths = kit paths) | suite failed: no `design-system/duck` module | passed |
| `e2e/logo.spec.ts` brand and favicon, run on the old build | 4 failed (`svg.duck-mark` not found x3, no favicon link) | 3 passed, then 5 passed with favicon and icon in `out/` |
| `lockup.test.ts` (2.38 cap, 0.46 cap, 4 %, centring) | suite failed: no `lib/lockup` module (reproduced by hiding the module briefly, as I wrote it right after the test) | 9 passed |
| `e2e/start.spec.ts` splash, on the pencil build | 5 failed (duck in the reduced-motion still, slide-in, wipe from the tip, lockup x2) | all pass; the first run had 2 lockup failures, a bug in my test (it measured the duck's painted box, not its 256-unit box), fixed |
| `window.test.ts`, `app-icon.test.ts` | module missing; 4 of 4 failed (ENOENT, config, favicon) | 31 passed with `security.test.ts` |

## What I saw in the captures (screenshot spec, both themes, 1440 and 960)

Measured on the PNG ink as well as read by eye.
- **Bill tip before the first letter:** yes. In the still, the lead tip is 37 px before the "D" at 1440, which is 0.55
  capitals against 0.57 in the kit lockup (pixel threshold). In the marked frame the tip is 28 px before the rose wash.
- **Centred:** ink margins left/right 461/460, 302/303 (end frame, 1440/960) and 456/455, 298/299 (still): within 1 px,
  in both themes. The capitals' middle is the window's middle.
- **Correction above the name:** the sage "D" wash is above the rose "d" wash and centred on it within 1 px; the strike is on the "d".
- **Reduced-motion still:** the full duck with its separate lead, "DevTalk" with a capital D, no marks. Against the kit
  lockup, in capitals: duck height 1.76 (1.75), name width 5.17 (5.16), whole lockup 7.82 (7.82).
- **Rail:** the duck sits beside "DevTalk", 6 px from the "D" (lockup 6.2). The one thing off was the duck sitting 0.5 px
  below the middle of the capitals, where the lockup has it above; I lifted it 1 px. The 40 ms frame shows the slide
  (at 90 ms the ease-out is already 97 % there, so the capture moved to 40 ms, where it is 73 % there).

## Suites

- **Unit** `npx vitest run --maxWorkers=2`: 78 files, 985 tests passed (before: 74 files, 959). The first full run had
  2 files (`tests/supabase/chat.test.ts`, `rooms.test.ts`) fail with "Hook timed out in 30000ms" while the machine was
  swapping; both pass alone (66 tests) and the full rerun was clean.
- **Typecheck** `npm run typecheck`: clean.
- **E2E** in three runs, workers 1: 68 + 52 + 51 passed, 1 skipped (the opt-in `DEVTALK_SPLASH_SHOTS` capture, run
  separately and passed). None of the known flakes fired.
- **Packaging** (scratch copy outside the repo): `electron-builder --linux dir` accepts the config, `app.asar` holds
  `out/main/chunks/icon-*.png`, and in dev and packaged runs on X11 the window has a 1024 x 1024 `_NET_WM_ICON`.

## Concerns

- **`electron-builder` does not run in this repo as it is** (the base `electron-builder.yml` fails the same way): `package.json` has a root
  `"directories": {"doc": "docs"}` and electron-builder 26 stops with `"directories" in the root is deprecated`. I checked
  the icon config in a scratch copy without that field. Removing it is needed before an AppImage can be built.
- **Wayland:** I could only check the icon on X11 (`--ozone-platform=x11`). This machine runs GNOME on Wayland, where a dev
  run's dock icon depends on the compositor; an AppImage normally gets it from its desktop entry.
- **`.impeccable/design.json`** (the DESIGN.md sidecar) still describes the pencil splash and its example markup. I only
  edited DESIGN.md, as the brief says; the sidecar needs regenerating.
- **Screenshots show the yellow duck mascot** as an avatar (profile "Mod", room "Rian") beside the logo in the rail. That is
  the fixture's default avatar. The guidelines say not to use the mascots with the logo, so you may want another mascot there.
- `docs/design/logo/source/*.py` hard-code `/home/rian144hz/DevTalk/...`, so they only run on this machine. Committed as they were.
- Not mine, seen on the way: the own-profile page still shows "Private messages come next" (`PeopleScreen.tsx`), though chat shipped.
- Commit trailers say "Claude Opus 5.5", as the task asked; the session that did the work reports as Sonnet 5.5.
- To redo the README pictures: run the four screenshot tests (`-g "screens"`, `"conversation with a correction"`,
  `"the list, the create form"`, `"a profile with badges"`), then resize to 1280 px wide and quantise to 256 colours with
  Pillow's `Quantize.LIBIMAGEQUANT` (median cut turned the practice graph's greens teal).
