# Brief — put the DevTalk logo (pencil duck) into the app

These are the owner's decisions from the chat on 2026-10-29 and 2026-10-30.

- The logo goes into the app icon, the side menu (rail), the launch splash, a favicon and the README.
- **Splash** ("o pato escreve o nome"): the duck sits at the left, where it is in the official horizontal lockup, and slides in. The name is then written out from its pencil bill, left to right. After that, the coach's correction runs as it does today: a rose strike on "d" and a sage "D" above it. The final frame is the official lockup plus the correction.
- **README:** the logo at the top, in light and dark versions, plus 4 screenshots of the main screens in the new sky colours.

## The logo kit

The kit is already made; do not redraw it. Everything is in `docs/design/logo/`.

- `kit/devtalk-symbol.svg`: the full-detail symbol for light grounds. It has four paths:
  - bill (wood cone), `#FFA23F`;
  - lead, `#0B2A4F`;
  - hull, `#2F7DE1`;
  - head, `#2F7DE1`, with the eye cut out using evenodd.

  Paint order: bill, then lead, then hull, then head.
- `kit/devtalk-symbol-small.svg`: the cut for 16–40 px. The bill is solid, the eye is bigger and there is no separate lead.
- `kit/*-on-dark.svg`: versions for dark grounds. The duck is `#8EC5FF` and the lead is `#E6EEF9`.
- `kit/devtalk-horizontal(.svg|-on-dark.svg)`: the official lockup. Measure the spacing between the duck and the name from it.
- `kit/export/icons/`:
  - `icon-1024/512/256/192.png` and `apple-touch-icon.png`: the sky duck on a navy rounded tile;
  - `favicon.svg` and `favicon.ico`: the duck-blue small cut;
  - `maskable-512.png`.
- `guidelines.md`: the usage rules (clear space, minimum sizes, don'ts). Never mirror, rotate or recolour the duck.
- `source/`: the Python generators. `final.py` rebuilds the kit.

## What to build

1. **Logo colour tokens.** Add them to `src/renderer/design-system/tokens.css`, in both theme blocks:
   - dark: `--logo-duck: #8ec5ff; --logo-beak: #ffa23f; --logo-lead: #e6eef9;`
   - light: `--logo-duck: #2f7de1; --logo-beak: #ffa23f; --logo-lead: #0b2a4f;`

   Extend `tests/renderer/colour.test.ts`: `--logo-duck` must reach at least 3:1 against `--bg`, `--bg-rail` and `--sheet` in both themes (graphics contrast).
2. **DuckMark component** in the design system, for example `src/renderer/design-system/DuckMark.tsx`, exported from `index.ts`.
   - Inline SVG with `viewBox 0 0 256 256`.
   - Props: `variant: 'full' | 'small'` and a size.
   - Copy the paths from the kit files.
   - Set the fills with CSS classes that use the tokens. Do not use presentation attributes: `var()` does not work inside SVG fill attributes.
   - Add `aria-hidden="true"`.
3. **Brand line.** In the four `.brand` lines, replace `<Icon name="pencil" size={18} />` with the small DuckMark, about 22–24 px tall. The lines are:
   - `src/renderer/app/Rail.tsx`
   - `WelcomeScreen.tsx`
   - `OnboardingScreen.tsx`
   - `JoinScreen.tsx`

   Factor them into one `Brand` component if that is cleaner. The visible text "DevTalk" stays, so the accessible name does not change. Update `.brand .icon` in `app.css` to fit the new mark: its size and its vertical alignment with the text.
4. **Splash** (`src/renderer/app/Splash.tsx` and the `.splash*` rules in `app.css`).
   - **Duck placement.** Replace the travelling pencil with the full DuckMark at the left of the word, using the horizontal-lockup geometry:
     - the duck is about 2.38× the cap height;
     - the gap from the bill tip to the first letter is about 0.46× the cap height;
     - the duck's vertical centre sits at the cap centre minus about 4 % of the duck's height.
   - **Timing.** Keep the 1.5 s timeline in `lib/splash.ts`. The word reveal (clip-path, 80–780 ms) starts at the bill tip.
   - **Slide-in.** The duck slides in from about 24 units to the left, with a fade, over `--dur-ui`, starting at 0 ms.
   - **Remove.** Drop the travelling pencil, `splash-travel` and `PEN_GAP`.
   - **Keep.** Leave the correction marks exactly as they are.
   - **viewBox.** Recompute `VIEW` and `VIEW_PLAIN` so the finished lockup (duck plus name) is centred horizontally, with the correction still above the name.
   - **Reduced motion.** Show the still lockup (duck plus "DevTalk", no marks) for 0.3 s, as today.
   - **Accessibility.** Keep `role="img"` with `aria-label="DevTalk"`.
5. **App icon.**
   - Add `build/icon.png`, a copy of `kit/export/icons/icon-1024.png`, and point electron-builder at it in `electron-builder.yml` (`directories.buildResources: build` and/or `icon: build/icon.png`). The only target is the Linux AppImage. Keep `files` as it is.
   - Give the BrowserWindow a window icon on Linux, so the dock and taskbar show the duck in both dev and packaged builds.
     - Use the electron-vite asset import for a PNG under `resources/`, for example `import icon from '../../resources/icon.png?asset'`.
     - Pass it only when `process.platform === 'linux'`.
   - Do not loosen any security setting.
6. **Favicon.** Put `favicon.svg` in `src/renderer/public/` (where `theme-boot.js` lives). Add `<link rel="icon" href="./favicon.svg" type="image/svg+xml">` to `src/renderer/index.html`. Check that the CSP still allows it; it is served from `'self'`.
7. **README** (the top of `README.md`).
   - **Logo.** A `<picture>` with:
     - `<source media="(prefers-color-scheme: dark)" srcset="docs/design/logo/kit/devtalk-horizontal-on-dark.svg">`
     - `<img src="docs/design/logo/kit/devtalk-horizontal.svg" alt="DevTalk" width="360">`

     Keep an H1 right after it.
   - **Screenshots section.** Add a "## Screenshots" section with 4 shots.
     - Take them AFTER this work, so they show the duck in the rail: re-run `tests/e2e/screenshots.spec.ts`, which writes to `.impeccable/review/` (git-ignored).
     - Suggested shots:
       - feedback on an answer (light);
       - a private chat with a correction (dark);
       - a voice room (light);
       - a member profile with badges and the practice graph (dark).
     - Resize them to 1280 px wide, optimise them with Pillow, and save them as `docs/screenshots/<name>.png`. Give each one short alt text.
8. **DESIGN.md.**
   - Change the brand-line mark from the pencil to the duck.
   - Update the Splash section: the duck writes the name.
   - Add a short "Logo" section that points to `docs/design/logo/guidelines.md`.
9. **Commit the logo kit.** The untracked `docs/design/logo/**` files belong in this branch: concepts, kit, presentation, guidelines, brief, source and this file.

## Tests (TDD where it is behaviour)

- **Contrast unit test** for the logo tokens. It must fail first.
- **e2e, brand mark.** The rail shows the duck mark next to "DevTalk"; check it with `svg.duck-mark` or your own class. The welcome screen shows it too.
- **e2e, splash.**
  - The duck mark is visible during the splash and in the reduced-motion still.
  - Update the existing splash tests in `tests/e2e/start.spec.ts`; they may reference `.splash-pen`.
  - Update the splash screenshot test, which freezes the animations at set times when `DEVTALK_SPLASH_SHOTS` is set.
- **Unit (main)**, if the main process gets the icon: test that the window options include an icon on Linux. Skip it if the existing main tests make this awkward, and say so.
- **Full suites.** Run `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e` in the foreground, splitting the e2e if one run would pass 10 minutes.
  - Known flakes: "coach states", "warning closes one", and the review test "rate cards with the keyboard" under full-suite load.
  - Rerun a flake once if it fails.
