---
name: DevTalk
description: A desktop English coach for developers that marks your writing like an editor's proof, with edits instead of grades.
colors:
  graphite-ground: "#16181d"
  graphite-rail: "#121419"
  galley-sheet: "#20232b"
  galley-sheet-hover: "#262a33"
  rule: "#2b2f39"
  rule-strong: "#3a3f4b"
  ink: "#e8e6e1"
  ink-secondary: "#b4b9c5"
  ink-tertiary: "#8c93a3"
  pencil-blue: "#7fb2e5"
  pencil-ink: "#0d1622"
  pencil-wash: "rgb(127 178 229 / 0.12)"
  dusty-rose: "#d99aa8"
  dusty-rose-wash: "rgb(217 154 168 / 0.12)"
  sage: "#8cc5a2"
  sage-wash: "rgb(140 197 162 / 0.12)"
  amber-warn: "#e0b26a"
  focus-blue: "#9cc6f0"
  community-violet: "#b4a7f5"
  evolution-copper: "#e39a6c"
  graph-0: "#22262e"
  graph-1: "#1f4a31"
  graph-2: "#2e7a47"
  graph-3: "#43a862"
  graph-4: "#6fd38a"
  light-ground: "#eef0f3"
  light-rail: "#e6e9ee"
  light-sheet: "#ffffff"
  light-sheet-hover: "#f6f7f9"
  light-rule: "#d5d9e0"
  light-rule-strong: "#bcc2cc"
  light-ink: "#1b1e24"
  light-ink-secondary: "#454b57"
  light-ink-tertiary: "#5c6370"
  light-pencil-blue: "#2c66a8"
  light-pencil-ink: "#ffffff"
  light-dusty-rose: "#a23e58"
  light-sage: "#2d7a4e"
  light-amber-warn: "#8a5a00"
  light-community-violet: "#5b46c4"
  light-evolution-copper: "#a4532a"
  light-graph-0: "#e1e4e9"
  light-graph-1: "#b5e2c1"
  light-graph-2: "#6dc58a"
  light-graph-3: "#3b9b5d"
  light-graph-4: "#236b3f"
typography:
  display:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.6
  caption:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.6
  galley:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.85
  expression:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.0625rem"
    fontWeight: 500
    lineHeight: 1.4
  mono-small:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  cell: "2px"
  chip: "4px"
  control: "6px"
  sheet: "10px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "40px"
  s14: "56px"
components:
  button-primary:
    backgroundColor: "{colors.pencil-blue}"
    textColor: "{colors.pencil-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.galley-sheet-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-quiet-hover:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.mono-small}"
    rounded: "{rounded.chip}"
    padding: "1px 8px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  input:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  textarea-answer:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.galley}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "180px"
  galley:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.galley}"
    rounded: "{rounded.sheet}"
  expression-card:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "16px 20px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  nav-item-active:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
  rail:
    backgroundColor: "{colors.graphite-rail}"
    width: "232px"
  avatar:
    backgroundColor: "{colors.galley-sheet-hover}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    width: "40px"
  stack-tag:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  textarea-short:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "96px"
  dialog:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "24px"
    width: "520px"
  radio-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
  radio-row-hover:
    backgroundColor: "{colors.galley-sheet-hover}"
  confirm-panel:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "16px 20px"
  queue-row-selected:
    backgroundColor: "{colors.galley-sheet-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 8px"
  member-badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px 2px 8px"
  graph-cell:
    backgroundColor: "{colors.graph-0}"
    rounded: "{rounded.cell}"
    size: "10px"
  banner:
    backgroundColor: "{colors.graphite-rail}"
    rounded: "{rounded.sheet}"
  avatar-profile:
    backgroundColor: "{colors.graphite-ground}"
    rounded: "{rounded.pill}"
    width: "96px"
    padding: "5px"
  mascot-option:
    rounded: "{rounded.pill}"
    size: "48px"
---

# Design System: DevTalk

## Overview

**Creative North Star: "Galley Proof"**

Every answer the learner writes is a galley, and the coach marks it the way an editor marks a proof: in non-repro blue pencil, with numbered carets in the line and short notes in the margin beside the line they mark. Removals are struck through in dusty rose and insertions sit beside them in sage; these are edits, not grades. The interface around the galley is a quiet desktop tool: a graphite ground, raised sheets with 1px rules, sans-serif chrome, and monospace wherever the learner's own words or a reusable expression appear.

Density is that of a working document rather than a dashboard. Content is set in one main column with a narrow side column; lists are ruled, not boxed; headings are sentence-case and plain. The system rejects the category default it was built against: a grey dashboard of stat cards with one violet accent. Progress is shown as facts, ruled lists and tally marks, never as metric tiles.

Dark is the default theme; a light theme swaps to a cool white sheet on pale grey with a darker pencil. Both themes share every structural rule.

**Key Characteristics:**
- One accent, pencil blue, carrying only the coach's voice and the primary action.
- Desaturated rose/sage diff marks on monospace text; never "wrong/right" colouring.
- Flat raised sheets defined by 1px rules; shadow only on floating layers.
- Margin notes aligned row by row to the line they annotate.
- Sentence-case, untracked type throughout; no uppercase labels.
- A few identifier colours (badge violet and copper, language brand colours, the graph green), each confined to one component.

## Colors

A graphite (or pale cool-grey) document palette with one blue pencil and a pair of muted proof marks.

### Primary
- **Non-Repro Pencil Blue** (`pencil-blue`; `light-pencil-blue` in light theme): the coach's voice. Numbered proof carets, margin-note labels, the primary button fill, the coach progress bar and current step, tally marks, the "ok" requirement status, the brand mark, links and the underline on highlighted expressions in the fluent rewrite. Its wash (`pencil-wash`) is the text-selection colour. Text on a pencil fill uses `pencil-ink`.

### Secondary
- **Dusty Rose** (`dusty-rose`, with `dusty-rose-wash` behind it): deleted text in a galley, struck through at 1.5px. Used for nothing else.
- **Sage** (`sage`, with `sage-wash`): inserted text in a galley, never underlined. Used for nothing else.

### Tertiary
- **Proof Amber** (`amber-warn`; `light-amber-warn`): field errors, invalid-field borders, and the tinted border of error notices (mixed 55% into the rule colour). Problems with the app are amber; the learner's mistakes are never amber.
- **Community Violet** (`community-violet`; `light-community-violet`): the icon and tint of community member badges, and nothing else.
- **Evolution Copper** (`evolution-copper`; `light-evolution-copper`): the icon and tint of evolution (milestone) member badges, and nothing else. Technical badges use secondary ink (`--badge-neutral`) in the same role.
- **Language brand colours** (outside the token set): a language badge takes its Simple Icons brand colour, mixed towards white (dark theme) or black (light theme) in 1% steps until it reaches 3:1 against both the ground and the sheet of that theme; no brand colour means secondary ink. Both theme values are set on the badge so a theme switch needs no re-render.
- **Graph Green** (`graph-0` to `graph-4`; `light-graph-0` to `light-graph-4`): the practice graph's own five-step ramp, from the empty day (`graph-0`, a near-ground grey) to the busiest. It is a different green from sage and lives only in the graph.

### Neutral
- **Graphite Ground** (`graphite-ground` / `light-ground`): app background and the fill of inputs, which sit "below" the sheet.
- **Graphite Rail** (`graphite-rail` / `light-rail`): the sidebar, one step darker than the ground.
- **Galley Sheet** (`galley-sheet` / `light-sheet`): raised surfaces: galleys, expression cards, the rewrite block, notices, the command palette, active and hovered nav rows. `galley-sheet-hover` is the next step for hover and selected states on a sheet.
- **Rule** (`rule`) and **Strong Rule** (`rule-strong`): 1px dividers and borders. Plain rules separate rows and sections; strong rules outline controls, chips, badges, keys and notices.
- **Ink** (`ink`), **Ink Secondary** (`ink-secondary`), **Ink Tertiary** (`ink-tertiary`): primary text, supporting text (ledes, margin notes, meanings), and hints/metadata. Tertiary ink passes AA on both grounds.
- **Focus Blue** (`focus-blue`; equals the pencil in light theme): the 2px focus outline.

### Named Rules
**The Blue Pencil Rule.** Pencil blue belongs to the coach and to the one primary action on a screen. It never decorates headings, backgrounds or icons that the coach did not "write".

**The Edits, Not Grades Rule.** Rose and sage appear only as a pair of diff marks inside the learner's text. They are never status colours, never fills, never "correct/incorrect" signals; app errors use amber.

**The One Home Rule.** Every colour outside the neutrals has exactly one home: blue for the coach and the primary action, amber for app problems, rose and sage for the diff, violet for community badges, copper for evolution badges, brand colours for language badges, graph green for the graph. The graph green is never shown next to a diff.

## Typography

**Display Font:** Public Sans Variable (with system-ui, sans-serif)
**Body Font:** Public Sans Variable (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, monospace)

**Character:** A neutral, slightly civic sans runs the interface; a programmer's monospace sets the learner's words, expressions, keys and counts, so "your text" and "the tool" read as two different materials.

### Hierarchy
- **Display** (700, 26px, 1.2, -0.01em): the single page title (h1), including the challenge title on Practice and Feedback.
- **Headline** (600, 17px, 1.3): section and sheet headings (h2): galley head, "Next: ...", side-column headings.
- **Title** (600, 14px, 1.4): sub-headings inside a sheet (h3) and field labels.
- **Body** (400, 15px, 1.6): all running text; ledes and briefs capped at the 68ch measure. The fluent rewrite is set larger (17px, 1.75).
- **Label** (500, 13px): margin notes, coach progress, hints, metadata, notice details, track lines.
- **Caption** (500, 12px): type badges, rail footer, "Later" tags.
- **Galley** (mono 400, 15px, 1.85): the learner's text in a galley and in the answer textarea. The open leading leaves room for strike-throughs and carets.
- **Expression** (mono 500, 17px; 20px on the review card): the phrase on an expression card.
- **Mono small** (mono, 12–13px): chips, `kbd` keys, nav counts, the model id.

### Named Rules
**The Two Materials Rule.** Monospace is reserved for the learner's own words, reusable expressions, keys and numbers; everything else is Public Sans. Never set interface chrome in mono or the galley in sans.

**The Sentence-Case Rule.** Headings and labels are sentence-case with no tracking. The only letter-spacing in the system is the display title's -0.01em.

## Layout

A fixed 232px sidebar rail sits beside a fluid page padded 40px top and 56px sides (32px sides below 1040px). Home and Feedback use a two-column grid: a fluid main column and a 300px (Home) or 280px (Feedback) side column with a 40px gap; below 1180px both collapse to one column, and the Feedback side column stops being sticky. Practice, Progress and Settings cap content at 860px or 760px; Onboarding and Review cards cap at 560px. The community screens follow the same rhythm: Join steps cap at 640px, People and the profile form at 760px, legal documents at the 68ch measure. Moderation is a 340px queue beside the selected report with a 40px gap, collapsing to one column below 1180px.

Inside a galley each line is a two-column row: the mono text, then a 248px margin column (200px below 1040px) separated by a 1px rule, so each note sits beside the line it marks. Spacing runs on a 4px base (4, 8, 12, 16, 20, 24, 32, 40, 56). Sections are separated by a 1px top rule plus 24px padding rather than by cards; page headers put the title left and actions right, aligned to the bottom.

The practice graph is 53 Monday-first week columns of 10px cells with 3px gaps; below a 1100px window width the cells drop to 9px and the gaps to 2px so the year fits without scrolling, and when it still overflows it scrolls sideways with the most recent weeks in view and the day column sticky. On the People profile a 3:1 banner spans the 760px column, the 96px avatar overlaps its lower edge by half (48px) and the head row is inset 20px.

## Elevation & Depth

The system is flat and tonal. Depth comes from three steps of surface (rail darker than ground, ground darker than sheet) and from 1px rules. Inputs sit on the ground colour so they read as recessed into a sheet. Shadow is used for exactly one thing: layers that float above the page.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px -8px rgb(0 0 0 / 0.55), 0 2px 6px rgb(0 0 0 / 0.35)`; light theme uses `rgb(20 24 32 / 0.22)` and `/ 0.12`): the command palette, the report dialog and other floating menus, over a 35% black backdrop.
- **Inset ring** (`box-shadow: inset 0 0 0 1px` strong rule): a selection outline, not elevation, on the checked segment, the selected palette row and the selected moderation report.
- **Separation ring** (`box-shadow: 0 0 0 2px` ground, `0 0 0 4px` ink): a selection outline, not elevation, on the checked mascot in the picker. The profile avatar's 5px ring over the banner is ground-coloured padding, not a shadow.

### Named Rules
**The Float-Only Rule.** Sheets, cards and buttons cast no shadow. If it is not floating over the page, it has no shadow.

## Shapes

Three radii, sized to the object: 4px for small inline things (chips, keys, segmented options), 6px for controls (buttons, inputs, nav rows, focus outlines), 10px for sheets (galleys, cards, notices, palette). Badges are full pills. Diff marks get a 2px corner on their wash, and practice-graph cells and legend squares share that 2px cell radius. Member badges are full pills; the banner takes the sheet radius; avatars and mascots are circles. Borders are always 1px; dashed borders mean "absent or open": the empty state and the "chunk" type badge. The numbered proof caret is a 16px circle outlined in pencil.

## Components

### Buttons
Calm and compact; the press is the only movement.
- **Shape:** gently rounded (6px), 9px by 16px padding, weight 500, optional trailing `kbd` hint.
- **Primary:** pencil fill with pencil-ink text; at most one per view.
- **Secondary:** transparent with a strong-rule border; hover fills with the sheet-hover tone.
- **Quiet:** borderless secondary-ink text; hover raises to sheet with ink text.
- **Hover / Focus / Active:** colour changes over 180ms; press scales to 0.97 over 120ms on a strong ease-out. Focus is a 2px focus-blue outline offset 2px. Disabled is 50% opacity; busy shows a pulsing 6px dot.

### Chips
- **Style:** mono 13px expression text in a 1px strong-rule outline, 4px radius, no fill. Inside requirement lists and the due list it drops its border and padding to read as plain mono.
- **Type badges:** 12px pills. Phrasal verb: ink text, tertiary-ink border. Collocation: ink on sheet-hover fill. Chunk: secondary ink, dashed border.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** galley sheet on the ground.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px rule.
- **Internal Padding:** 16–24px; galley heads and general notes 16px by 24px; expression cards 16px by 20px (24px on the review card).

### Inputs / Fields
- **Style:** ground-colour fill, 1px strong-rule border, 6px radius, 8px by 12px padding; the answer textarea is set in the galley mono at 1.85 leading, min 180px.
- **Hover / Focus:** border shifts to tertiary ink on hover and to focus blue on focus.
- **Error:** amber border and an amber 13px message under the field; hints in tertiary ink.
- **Segmented control:** a ground-filled 6px track with 4px options; the checked option takes sheet-hover fill, ink, weight 600 and an inset ring.
- **Short textarea:** for prose that is not an answer (report details, warnings, bio): Public Sans at 1.6 leading, min 96px.
- **Checkboxes and radios:** native 16px controls with an ink accent, never pencil. Radio rows are 6px by 8px with a 6px radius, sheet-hover on hover, and the 2px focus outline on the whole row.

### Navigation
- **Rail:** darker rail tone, 1px right rule, brand row with a pencil-blue mark, a "Search or jump to..." button with `Ctrl K`, then nav rows.
- **Rows:** 14px secondary ink with a 1.6-stroke line icon, 7px by 12px padding, 6px radius. Hover and current page both take the sheet fill with ink text; current adds weight 600. Counts sit right-aligned in mono; unreleased items carry a tertiary "Later".
- **Command palette:** a 560px sheet at 14vh with the float shadow, a 17px borderless search input over a rule, rows with 6px radius; the selected row gets sheet-hover and an inset ring. It opens and closes without animation.
- **Moderation row:** shown only to moderators, last in the rail, with the shield line icon.

### Galley (signature)
The learner's text as a marked proof. A sheet with a heading row, optional "about the whole answer" notes, then line rows: mono text on the left with struck rose deletions, sage insertions and numbered pencil carets; on the right, the margin column with the matching numbered note label in pencil and the explanation in secondary ink. Lines with no edits say so quietly in the margin. Before the coach answers, the margin stays empty.

### Expression card
Same layout everywhere: mono phrase with its type badge top-right, meaning in secondary ink, an example sentence, optional footer in tertiary ink.

### Coach progress
Waiting is shown as a step list (current step in pencil, done steps in secondary ink) and a 2px rule-coloured track with a sliding pencil segment, plus a cancel action. Under reduced motion the segment stops and fills the track at half opacity.

### Tally marks
Recurring mistakes are counted with drawn pencil tally strokes (2px by 16px, a rotated bar across each five) beside a mono count, inside ruled lists.

### Avatar
A circle with a 1px strong-rule border: the person's photo, or the first letter of the name in secondary ink, weight 600, on sheet-hover. Never coloured per person. A photo that cannot be decoded falls back to the initial. The name is always shown beside it. Sizes: 72px on a profile, 32px in lists.
Without a photo, a member's avatar shows their mascot: one of nine bundled illustrations (ducks, bears, axolotls; provenance in `docs/design/mascots/SOURCE.md`), chosen in Edit profile or picked from their id. The photo always wins; the initial remains only where there is no member id. The mascot fills the same ruled circle, so the ring is still never coloured. On the People profile the avatar is 96px inside a 5px ground-coloured ring that overlaps the banner.

### Mascot picker
In Edit profile, once the profile exists: a wrapping row of nine 48px mascot circles with 8px gaps, each a visually hidden radio with the mascot's name as its title. The checked mascot gets the separation ring (2px ground, then 2px ink); keyboard focus adds the 2px focus outline offset 5px. The hint says whether people see the photo or the mascot.

### Stack tag
A technology on a profile: its Simple Icons logo at 14px in `currentColor` (the text tone), then its name in 14px Public Sans, inside a 4px chip outline in strong rule. Unknown technologies show the name only. Logos identify; they never decorate.

### Member badges
A member's badges as a wrapping row of pills (6px gap) under the profile head, in a fixed group order: community, technical, language, evolution. Each pill is 13px ink text with 2px by 10px padding (8px on the icon side), a fill of the group colour at 11% and a border mixing the group colour 50% into the strong rule. The colour is carried by the icon: a 15px, 1.6-stroke line icon on a 16px grid, or a 14px Simple Icons logo for languages. The label never takes the group colour. A hint, when present, is the title and is read after the name. What a badge may mean is set in PRODUCT.md. Member badges are distinct from the expression type badge, which stays a neutral 12px pill.

### Practice graph (signature)
Practice per day over the last 53 weeks, on Progress and on the People profile. From top: a secondary-ink facts line in tabular figures; month labels and a Mon/Wed/Fri day column in 12px tertiary ink; the grid of 2px-radius cells in the five graph-green steps; then a footer with the day's text line in 13px secondary ink (a polite live region, with an idle hint until a day is chosen) and a "Less ... More" legend of five cells at the grid's right edge. Hovering a cell outlines it 1px in ink. The grid is one tab stop; arrow keys, Home and End move between days, the selected day gets the 2px focus outline offset 1px and its text is announced. No diff appears on the same screen.

### Banner
A profile cover at 3:1 with the sheet radius, cropped to fill from the centre, at the top of the People profile; without a banner, a plain 6:1 band in the rail tone keeps the layout. Animated banners move only while Settings › "Play animated banners" is on and the system does not ask to reduce motion; otherwise the first frame is shown still, and if it cannot be decoded nothing is drawn. The banner is decorative and hidden from assistive technology.

### Profile fact sheet
A profile is a ruled definition list, not a card: a 180px term column (140px below 1040px) in 14px secondary ink beside the value, every row ruled top and bottom. The moderation report detail uses the same sheet.

### Report dialog
The second floating layer after the palette: a 520px sheet with strong-rule border, the float shadow and a 35% black backdrop, opened and closed without animation. Heading, secondary-ink lede, radio rows for the reason, an optional short textarea, then Cancel (quiet) and Send report (primary) right-aligned.

### Block button and destructive confirmations
Blocking, deleting an account and moderation decisions confirm inline, never in a modal. The confirmation is a neutral panel: sheet fill, 1px strong rule, 10px radius, 16px by 20px padding. The guard is the input, not a colour: the typed e-mail enables account deletion, a required reason enables a suspension or warning. The confirming action is a secondary button.

### Moderation queue
Open reports as a ruled list: avatar, name in weight 600, reason and place in 13px secondary ink, date in tertiary ink. Hover takes the sheet fill; the selected row takes sheet-hover and an inset ring, like the palette selection. Each decision (dismiss, warn, suspend) is a section under a 1px top rule.

### Join steps
Join runs one step at a time in one column, like onboarding. The step count lives in the lede ("Step 2 of 4. Check your e-mail for a code."), never as a label above the heading. Consents are ruled rows with the document link right-aligned.

## Do's and Don'ts

### Do:
- **Do** keep pencil blue to the coach's marks, notes, progress and the one primary action per view.
- **Do** set the learner's text, expressions, keys and counts in JetBrains Mono, and everything else in Public Sans.
- **Do** align every margin note to the galley line it marks, numbered to match its caret.
- **Do** separate rows and sections with 1px rules and a top border rather than wrapping them in cards.
- **Do** use the three-step tonal stack (rail, ground, sheet) for depth, and the float shadow only for overlays.
- **Do** honour reduced motion: all durations drop to 0ms and looping animations stop.
- **Do** confirm destructive actions inline in a neutral panel, guarded by a typed e-mail or a required reason.
- **Do** let the icon carry a member badge's colour and keep its label in ink.
- **Do** show an animated banner's first frame, still, under reduced motion or when "Play animated banners" is off.

### Don't:
- **Don't** build a dashboard of stat cards or metric tiles; progress is facts, ruled lists and tallies.
- **Don't** use rose or sage outside the diff, or label anything "wrong" or "correct".
- **Don't** add a second accent colour or tint headings with the pencil. Badge violet and copper, language brand colours and the graph green are identifiers confined to their component, not accents.
- **Don't** use violet, copper or the graph green outside member badges and the practice graph, or show the graph beside a diff.
- **Don't** add shadows to sheets, cards or buttons.
- **Don't** uppercase or letter-space labels, or put small category labels above headings.
- **Don't** animate the command palette or the report dialog open or closed.
- **Don't** colour destructive actions amber or red; amber stays for problems with the app.
- **Don't** colour avatars or stack logos; logos take the text tone. A mascot is the only picture shown when there is no photo, and only language badges carry brand colour.
