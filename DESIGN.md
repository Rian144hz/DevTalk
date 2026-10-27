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
  chat:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
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
  people-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    padding: "8px 0"
  people-tab-current:
    textColor: "{colors.ink}"
  member-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 8px"
  member-row-hover:
    backgroundColor: "{colors.galley-sheet}"
  member-filter-field:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "42px"
  like-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  like-button-hover:
    backgroundColor: "{colors.galley-sheet-hover}"
  follow-notice:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "16px 20px"
  conversation-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 8px"
  conversation-row-current:
    backgroundColor: "{colors.galley-sheet-hover}"
  chat-pane:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  chat-bubble:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "{rounded.sheet}"
    padding: "8px 12px"
  chat-bubble-mine:
    backgroundColor: "{colors.galley-sheet-hover}"
  chat-correction:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px"
  chat-input:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "64px"
  coach-check:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sheet}"
    padding: "12px"
  room-sheet:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "20px 24px"
  room-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "12px 8px"
  mic-meter:
    backgroundColor: "{colors.graphite-ground}"
    rounded: "{rounded.chip}"
    height: "8px"
    width: "480px"
  mic-meter-fill:
    backgroundColor: "{colors.ink-secondary}"
  room-person:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "12px 8px"
  room-card:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "16px 20px"
    width: "320px"
  room-options:
    backgroundColor: "{colors.galley-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px 16px"
  room-bar:
    backgroundColor: "{colors.graphite-ground}"
    padding: "16px 0 20px"
  button-github:
    backgroundColor: "{colors.pencil-blue}"
    textColor: "{colors.pencil-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  welcome-actions:
    padding: "24px 0 0"
    width: "560px"
  splash:
    backgroundColor: "{colors.graphite-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
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
- **Caption** (500, 12px): type badges, rail footer.
- **Galley** (mono 400, 15px, 1.85): the learner's text in a galley and in the answer textarea. The open leading leaves room for strike-throughs and carets.
- **Expression** (mono 500, 17px; 20px on the review card): the phrase on an expression card.
- **Mono small** (mono, 12–13px): chips, `kbd` keys, nav counts, the model id, the seat count "n / 6" in the room list. The room timer's number is the one larger mono count: 20px, weight 600.

### Named Rules
**The Two Materials Rule.** Monospace is reserved for the learner's own words, reusable expressions, keys and numbers; everything else is Public Sans. Never set interface chrome in mono or the galley in sans.

**The Sentence-Case Rule.** Headings and labels are sentence-case with no tracking. The only letter-spacing in the system is the display title's -0.01em.

## Layout

A fixed 232px sidebar rail sits beside a fluid page padded 40px top and 56px sides (32px sides below 1040px). Home and Feedback use a two-column grid: a fluid main column and a 300px (Home) or 280px (Feedback) side column with a 40px gap; below 1180px both collapse to one column, and the Feedback side column stops being sticky. Practice, Progress and Settings cap content at 860px or 760px; Onboarding and Review cards cap at 560px. The community screens follow the same rhythm: Join steps cap at 640px, People and the profile form at 760px, legal documents at the 68ch measure. Moderation is a 340px queue beside the selected report with a 40px gap, collapsing to one column below 1180px.

Inside a galley each line is a two-column row: the mono text, then a 248px margin column (200px below 1040px) separated by a 1px rule, so each note sits beside the line it marks. Spacing runs on a 4px base (4, 8, 12, 16, 20, 24, 32, 40, 56). Sections are separated by a 1px top rule plus 24px padding rather than by cards; page headers put the title left and actions right, aligned to the bottom.

The practice graph is 53 Monday-first week columns of 10px cells with 3px gaps; below a 1100px window width the cells drop to 9px and the gaps to 2px so the year fits without scrolling, and when it still overflows it scrolls sideways with the most recent weeks in view and the day column sticky. On the People profile a 3:1 banner spans the 760px column, the 96px avatar overlaps its lower edge by half (48px) and the head row is inset 20px.

People opens with its tabs across the 760px column, 24px apart over a 1px rule, with 24px below. The member filters are a four-column grid (search 2fr, English level and Area 1fr each, Technology 1.2fr) with 16px gaps and 20px below; below 1100px they wrap to two equal columns. Member lists, follower lists and their loading skeletons share the 760px column.

Messages is the one full-height page: the page fills the window (100vh) and its body is a 300px conversation list beside the open conversation with a 32px gap, capped at 1100px; below 1040px the list drops to 240px and the gap to 20px. Notices and empty states above it keep the 760px column. The list scrolls on its own. Inside the conversation pane the thread takes the remaining height, scrolls, and never shrinks below 140px; the composer area under it scrolls instead when the coach check is open. Below 1040px the pane's inner padding drops from 20px to 16px sides, and on windows under 720px tall the page's bottom padding and head spacing tighten (20px, 16px).

Rooms keeps the 760px column on its list page: the head, notices, empty states, the create and join sheets and the room list are capped at 760px, with 20px below each block. A room is a full-height page (at least 100vh, no bottom padding): a fluid people column beside a 320px side column holding the idea card over the timer 20px apart, with a 40px gap, capped at 1100px; its notices keep the 760px cap. At 1040px and below the side column moves above the people as two equal columns with a 16px gap, and the people follow 20px below, so a long list never pushes the card and timer out of a short window. The control bar is sticky at the bottom of the page, capped at 1100px, 32px below the room; while a room is open the document's bottom scroll padding is 88px (56px + 32px), so a focused control or a panel that scrolls into view stops above the bar instead of under it. On windows 720px tall or less the room head's spacing drops to 16px and the bar's top margin to 20px, with 16px padding top and bottom.

The first run uses the Onboarding column (560px, 640px for embedded Join steps) and adds one offset rule. The welcome page is not centred: its top padding is `clamp(56px, 18vh, 176px)` and bottom 24px, so the heading sits a little above the middle and stays put as the actions swap between states, and the error state still fits a 960 by 640 window. Under the lede a 1px rule and 24px padding open the actions (32px above the rule), stacked 12px apart at the full column width. The splash is the one full-bleed screen: fixed over everything, centred on the theme ground, with the lockup 4.58 times a `clamp(64px, 6.5vw, 112px)` unit wide.

## Elevation & Depth

The system is flat and tonal. Depth comes from three steps of surface (rail darker than ground, ground darker than sheet) and from 1px rules. Inputs sit on the ground colour so they read as recessed into a sheet. Shadow is used for exactly one thing: layers that float above the page.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px -8px rgb(0 0 0 / 0.55), 0 2px 6px rgb(0 0 0 / 0.35)`; light theme uses `rgb(20 24 32 / 0.22)` and `/ 0.12`): the command palette, the report dialog and other floating menus, over a 35% black backdrop.
- **Inset ring** (`box-shadow: inset 0 0 0 1px` strong rule): a selection outline, not elevation, on the checked segment, the selected palette row, the selected moderation report, the current conversation row and the reported message in a moderation copy.
- **Separation ring** (`box-shadow: 0 0 0 2px` ground, `0 0 0 4px` ink): a selection outline, not elevation, on the checked mascot in the picker; the same ring, always in ink, marks who is speaking in a voice room, easing in and out over 180ms. The profile avatar's 5px ring over the banner is ground-coloured padding, not a shadow.

### Named Rules
**The Float-Only Rule.** Sheets, cards and buttons cast no shadow. If it is not floating over the page, it has no shadow.

## Shapes

Three radii, sized to the object: 4px for small inline things (chips, keys, segmented options), 6px for controls (buttons, inputs, nav rows, focus outlines), 10px for sheets (galleys, cards, notices, palette). Badges are full pills. Diff marks get a 2px corner on their wash, and practice-graph cells and legend squares share that 2px cell radius. Member badges are full pills; the banner takes the sheet radius; avatars and mascots are circles. Borders are always 1px; dashed borders mean "absent or open": the empty state, the "chunk" type badge and a deleted message. The numbered proof caret is a 16px circle outlined in pencil.

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
- **Rows:** 14px secondary ink with a 1.6-stroke line icon, 7px by 12px padding, 6px radius. Hover and current page both take the sheet fill with ink text; current adds weight 600. Counts sit right-aligned in mono.
- **Command palette:** a 560px sheet at 14vh with the float shadow, a 17px borderless search input over a rule, rows with 6px radius; the selected row gets sheet-hover and an inset ring. It opens and closes without animation.
- **Messages row:** after People, with the chat line icon (a speech bubble) and the unread count, requests included, in the same right-aligned mono count as Review's due count; the palette's "Go to Messages" is `Ctrl 5`.
- **Rooms row:** after Messages, with the rooms line icon (a microphone); the palette's "Go to Rooms" is `Ctrl 6`. While you are in a room, the row, the palette entry and `Ctrl 6` lead back to that room (`#/rooms/<id>`) instead of the list.
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
Without a photo, a member's avatar shows their mascot: one of nine bundled illustrations (ducks, bears, axolotls; provenance in `docs/design/mascots/SOURCE.md`), chosen in Edit profile or picked from their id. The photo always wins; the initial remains only where there is no member id. The mascot fills the same ruled circle, so the ring is still never coloured. On the People profile the avatar is 96px inside a 5px ground-coloured ring that overlaps the banner. In the member list it is 40px; in follow notices and the moderation queue it stays 32px.

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
A message report adds "The conversation" as one more such section: the copied messages as a list (12px gaps), each with the sender in weight 600 and the date and time in 13px secondary ink, then the message in the chat bubble (theirs style, left, up to 68ch). The reported message takes the sheet fill and the inset ring with the control radius and a "Reported" flag in weight 600; nothing turns red. When no copy was kept, a muted line says so.
A room report ("Voice room" as its place) adds "The room" the same way: the room's title, theme, host and opening time as a profile fact sheet, then who was in it as a ruled list (8px vertical padding, 14px): the name in weight 600 on the left and, right-aligned in secondary ink, when they joined and left ("23 October 2026, 17:13 to 17:13", or "…, still in the room"). A deleted account reads "Deleted account"; when no copy was kept, a muted line says so.

### Join steps
Join runs one step at a time in one column, like onboarding. The step count lives in the lede ("Step 2 of 4. Check your e-mail for a code."), never as a label above the heading. Consents are ruled rows with the document link right-aligned. The count follows the path: the e-mail way is "Step n of 4" (e-mail, code, rules, profile); GitHub has no code step, so after a GitHub sign-in the rules read "Step 2 of 3" and the profile "Step 3 of 3". Embedded in the first run, Join drops the page chrome for the onboarding column, offers "Skip for now" (quiet) on the rules and profile steps, and Back (quiet) on the sign-in step returns to the welcome. When the person already chose e-mail, GitHub is not offered and "Send code" becomes the one primary (and takes focus); otherwise the GitHub button is the primary, an "or" rule (a 1px rule either side, tertiary ink) separates it, and "Send code" is secondary.

### People tabs
Members, Following and Your profile as a row of route links in a labelled `nav`, not a segmented control. Each tab is 15px weight 500 in secondary ink with 8px vertical padding and a 2px transparent underline sitting on the 1px rule below the row; hover turns it ink. The current tab (`aria-current="page"`) is ink with a 2px ink underline, never pencil. A member's profile and their follower lists keep Members marked, since that is where they are reached from. A member list directly under the tabs drops its own top rule.

### Member list
People as ruled rows, one link per row, in the same grammar as the moderation queue: a 40px avatar or mascot, the name in weight 600 with the meta line under it ("Back end developer, B1", 13px secondary ink), and the member's main technologies as language badges on the right. Rows are 12px by 8px with the control radius; hover takes the sheet fill. Lists load 30 at a time; when a page comes back full, a secondary "Load more" button follows the list and shows the busy dot while it loads.

### Member filters
Above the member list: Search by name, English level, Area and Technology as ordinary fields with their labels. Text inputs and selects render at different natural heights, so the filter row forces both to 42px (2.625rem).

### Follow and like
Under a profile's name, a wrapping row (8px by 16px gaps, 20px below). On someone else's profile, Follow is the profile's one primary action, a pencil-filled button; once followed it becomes a secondary "Following" button. Their accessible names say what a press does: "Follow <name>" and "Stop following <name>". The like control is shaped like a secondary control (strong-rule outline, control radius, 9px by 12px, weight 500): a 16px heart line icon, filled in the text tone when liked (`aria-pressed`), and the count in tabular figures; hover takes sheet-hover. Then "N followers" and "N following" as 14px secondary-ink links in tabular figures that turn ink on hover. On your own profile only the counts show, with a 14px heart before the likes. Counts are plain facts; nothing is ranked or sorted by them.

### Follow notice
A new follower is an info notice (sheet fill, strong rule, 10px radius, 16px by 20px) laid out as one row with 12px gaps: the follower's 32px picture (photo or mascot), then "<linked name> followed you." with the date under it in 13px secondary ink, then Mark as read.

### Follower lists
"<name>'s followers" and "People <name> follows": a secondary-ink back link to the profile, the title at 20px, then the member list rows. Empty states name whose list it is ("No one follows Ana yet.", "You do not follow anyone yet.").

### Member profile
Another member's profile reuses the profile sheet (banner, head, badges, fact sheet, graph) with Follow and like under the name. Report (quiet) and Block (secondary, confirmed inline) sit in a footer under a 1px top rule, 24px above and 16px inside it. A profile that is gone, suspended or blocking you is an empty state, "This profile is not available.", with a secondary "Back to Members".

### Conversation list
Messages opens with Requests, then Conversations (the second heading shows only when there are requests), each a 15px weight 600 heading over ruled rows in the member list's grammar: a 40px avatar or mascot, the name in weight 600 over a one-line preview in 13px secondary ink, cut with an ellipsis; on the right the time (12px tertiary ink, tabular figures) over the unread count in 12px mono weight 600, ink. A deleted last message reads "Message deleted" in tertiary ink; a request you sent reads "Waiting for <name>". Rows are 12px by 8px with the control radius; hover takes the sheet; the open conversation (`aria-current="page"`) takes sheet-hover and the inset ring, like the palette selection.

### Conversation pane and message bubbles
The open conversation is a sheet with a 1px rule and the sheet radius: a head row (32px avatar, the name at 15px weight 600 linking to the profile) over a rule, the thread on the ground colour, and the composer under a rule. Days are separated by a 12px weight 500 tertiary label centred between two 1px rules. Messages are bubbles in JetBrains Mono 14px at 1.6, `pre-wrap`, with an 8px by 12px padding and the sheet radius: theirs on the left on the sheet with the rule, yours on the right on sheet-hover with the strong rule. A bubble is at most 75% of the thread (and 68ch); below 1040px, 90%. The time sits under each bubble in 12px tertiary ink, tabular figures. A deleted message keeps its place as a dashed, transparent outline with "Message deleted" in tertiary Public Sans. Older messages load with a secondary "Load earlier" at the top.

### Message actions
Quiet buttons at 12px with 2px by 8px padding on the time row under a message: Suggest a correction and Report on theirs, Delete on yours (mirrored to the right on yours). They fade in over 180ms on hover and keyboard focus, are always shown on touch screens (`hover: none`), and always shown on the newest incoming message. Each names its message in its accessible name ("Report Bia's message at 21:31"). Delete confirms inline in the neutral panel with the strong rule ("Delete this message? Its corrections go too. This cannot be undone.", Delete secondary, Cancel quiet). When the panel or the correction editor closes, focus returns to the message.

### Peer correction
A correction is a sheet note under the message (1px rule, sheet radius, 12px padding): "<name> suggested" or "Your correction" in 12px secondary ink, then the message as a word diff in the chat mono with the galley's marks: struck rose deletions and sage insertions on their 2px-corner washes. Marks cover the words only; a trailing space stays plain, and each mark carries a hidden "removed:" or "added:" for screen readers. The sender of the message gets a quiet 12px Thanks; after it, "Thanked" in 12px secondary ink. Suggesting opens the same note with the strong rule: a mono textarea prefilled with their text, the live diff, Suggest (secondary) and Cancel (quiet); Escape cancels.

### Composer and coach check
The composer is the mono chat textarea (min 64px, max 200px, no resize) over a row with the counter "n / 2000" in 12px tertiary mono on the left, turning amber past the limit, and on the right Check with the coach (secondary) and Send (primary, the pane's one primary). Enter sends; Shift+Enter starts a line. The check opens above the textarea as a panel on the ground with the strong rule and the sheet radius: "The coach on your draft" in 12px secondary ink, the draft as a word diff, then notes in 13px secondary ink, each led by the edit ("have fixed → fixed") in pencil mono, then "A more natural way:" in ink weight 600 before the suggested wording. Use this version (secondary) and Keep mine (quiet) close it; with nothing to change it says "The coach found nothing to change." and offers Close.

### Request card and first message
An incoming request replaces the composer with a card under a rule: "<name> wants to practise with you." in ink weight 600, then "Accept to reply. If you decline, <name> is not told." in secondary ink; Accept (primary), Decline (secondary). Declining is silent: nothing tells the sender. While your request waits, the composer is replaced by "Waiting for <name>. You can write more when they accept." in secondary ink. Send message on a profile opens `#/messages/to/<id>`: the pane with the member's head, "Message <name>" at 17px, a lede that the first message is a request, a four-row mono textarea, the counter and Send request (primary), capped at 640px.

### Room list
Rooms opens with the page head ("Talk in English by voice, up to 6 people. Your voice goes straight to the others and is never recorded.") and Create a room on the right as the page's one primary. Live rooms are ruled rows under a 1px top rule, 12px by 8px with 16px gaps: the title in weight 600 over a 13px secondary-ink line with the theme, the level and the host ("Code review, B2. Host: Lia"); then the people's faces as 24px avatars or mascots 4px apart (their names given to screen readers); the seats "n / 6" in 13px secondary mono; then Join (a secondary link named "Join <title>") or, with six in, "Full" in 13px tertiary ink, no control. A row is not a link and takes no hover fill. With no rooms, the empty state says "No rooms right now." and "Create one and others can join." Without the community the screen is an empty state ("Join the community to talk in rooms", with Join the community as the primary); a room that ended or filled is "This room is not open." with a secondary "Back to Rooms". Leaving a room comes back here with an info notice saying why ("You ended the room.").

### Create a room and microphone check
Both are sheets at the top of the 760px column (sheet fill, 1px rule, sheet radius, 20px by 24px, 16px between parts) under a 17px heading: "Create a room", or "Join <title>" with the lede "Stand-up, B1, 2 / 6. Check your microphone first." Create asks for a Title (with the hint "3 to 60 characters. Everyone sees it in the list."), the Theme as a segmented control (Stand-up, Code review, Interview, Free talk) and a Suggested level select (Any level, A1 to C2); fields cap at 480px. Then the microphone check, also 480px: the label "Your microphone", an 8px meter (ground fill, strong-rule border, chip radius) whose secondary-ink fill grows from the left with the voice level, and the hint "Say something. The bar moves when DevTalk hears you. Nothing is recorded." A refused or missing microphone replaces the meter with an error notice and Try again (secondary). Join room or Create is the sheet's primary, disabled until the microphone is open; Cancel is quiet. While the create sheet is open the head's Create a room is hidden, so the view keeps one primary.

### Room view
The head is the room's title (h1) with the lede "Interview, B2, 4 / 6. Host: Rian". Under it the notices, then an arrivals line ("Hugo joined.") in 13px secondary ink that clears after ten seconds and keeps its height so nothing jumps.
- **People:** a "People" heading over ruled rows, 12px by 8px: the 40px avatar or mascot, the name in weight 600 (yours followed by "(You)" in secondary ink, weight 400), and a 13px secondary-ink line joining the level, the role label (Host or Room moderator, nothing for a member) and the call status (Muted, Muted for you, Connecting…, Could not connect). A muted person shows the 16px mic-off line icon in secondary ink; everyone else's row ends with Options (quiet). Whoever is speaking gets the separation ring around their face, in ink, plus a hidden "Speaking"; it is the only speaking signal.
- **Idea card:** a sheet in the side column (16px by 20px): "Idea card", the prompt at 17px weight 400 with 1.5 leading, and Next card (secondary). Anyone in the room can turn it; everyone sees the same card.
- **Timer:** the same sheet: "Timer", then while idle "A guide for everyone in the room. Start one when someone speaks." in 13px secondary ink; while running "<n> s left" at 17px weight 600 with only the number in mono (20px); then "Time is up." 60 s and 90 s are secondary; Stop (quiet) shows while it runs. The timer is shared.
- **Notices:** info notices for "Reconnecting…" and "The host muted you. You can unmute when you are ready."; everyone the call could not reach is named in one error notice ("Could not connect to Bia and Caio. Your network may block calls."), never one per person. They stack 8px apart, capped at 760px.
- **Bottom bar:** sticky on the ground colour under a 1px top rule, 12px gaps: Mute or Unmute (secondary, with the mic or mic-off icon and the `Ctrl M` hint; Ctrl+M works anywhere in the room), Leave (secondary) and, for the host, End room (quiet). The bar is there even while the room loads or cannot be read, because the microphone is live. End room confirms inline in the bar as a neutral panel in a row: "End the room for everyone? The call stops for all.", End room (secondary), Cancel (quiet); Escape cancels and focus returns to End room. There is no pencil primary inside a room, on purpose: speaking is the main act, not a button.

### Person options
Options opens an inline neutral panel under the person's row (sheet fill, strong rule, sheet radius, 12px by 16px, inset 8px), labelled "Options for <name>", scrolled into view above the bar. The first group is for you: Mute for me (Unmute for me once set) and Report as quiet buttons, then Block <name> as a secondary button that confirms inline like any block; blocking someone in a room makes you leave it. When your role allows, a second group follows under a 1px rule with 12px above it, all secondary: Mute for everyone, Make moderator (or Remove moderator role), Make host, Remove. Make host and Remove swap the panel for an inline neutral confirmation ("Make Hugo the host? You stop being the host.", "Remove Hugo from this room? Hugo cannot come back to this room."): the confirming action secondary, Cancel quiet. A done action reports in 13px secondary ink ("You muted Hugo. Hugo can unmute when ready."); a failure shows as an amber field error. Escape closes the panel or cancels the confirmation, and focus returns to the button that opened it (Options, Make host or Remove).

### Splash
The launch screen, shown on every launch over everything on the theme ground (the blocking `theme-boot.js` sets the theme before the first paint, so the first frame is already the right ground). A pencil writes "DevTalk" left to right in display-weight Public Sans 700 (-0.01em, ink) as a lowercase "devTalk"; then it is marked like a proof: the "d" turns dusty rose with a rose strike and wash, and a sage "D" with its wash is written above it. The pencil is the rail's pencil mark in pencil blue, 120 units, its tip on the baseline and ending 12 units past the "k". Nothing else is on screen: no tagline, no progress, no button.
- **Timing** (from `lib/splash.ts`, the only source): shown 1500ms, then a 250ms fade on the strong ease-out, after which the next screen appears. Inside the 1500ms: pencil in 0 to 180ms, name written 80 to 780ms (700ms on the even `--ease-write`, `cubic-bezier(0.37, 0, 0.63, 1)`), "d" struck 820 to 1000ms (`--dur-ui`), "D" written 960 to 1200ms (`--dur-panel`, rising 6px), then a hold.
- **Reduced motion:** the finished name stays still, "DevTalk" with the pencil after it, no marks and no fade: 300ms, then the next screen.
- **Skip:** a click, Enter, Space or Escape ends it at once; the keys are caught before anything under it. It is a labelled image ("DevTalk"), not a control.
- **Marks:** the rose and sage are the diff's own marks applied to the name, the one place they appear outside a correction; they stay the diff pair in both themes.

### Welcome (first run)
The first screen of a first run, in the coach setup's column: the pencil and "DevTalk" brand line, a 20ch heading ("Practise the English you use at work."), a lede, then the actions under a 1px rule. One primary per view: when the community is configured it is "Continue with GitHub", then "Continue with e-mail" as a secondary, then "Practise without an account" as a quiet button; when the build has no community only "Practise without an account" shows, and it becomes the primary. Buttons span the column at 11px vertical padding.
- **Waiting:** the three buttons are replaced by a quiet 14px spinner (a rule-strong ring with a secondary-ink arc, turning 0.9s, still under reduced motion) and "Finish signing in with GitHub in your browser." with "Then come back here." under it in secondary ink, and a secondary Cancel right after the text, focused. Escape cancels. On Cancel or a failure, focus returns to the first button.
- **Error:** an error Notice above the buttons, titled "Sign-in was not finished." with the main process' words as detail; when the answer is only "Sign-in was not finished. Try again." it stands alone as the title. A member's own Cancel shows no notice.
- **No status:** while the community status is unknown (up to 3s) the screen waits; a slow answer is treated as no community.

### GitHub button
"Continue with GitHub" is the primary button with the GitHub mark (Simple Icons, CC0, 16px) before the label, drawn in `currentColor` so it takes the pencil-ink text colour in both themes. The mark is never brand-coloured and never alone; it sits only on this button. It is the one primary of a sign-in screen (Welcome, Join step 1) and follows every button rule above.

### First-run flow and provenance hints
Welcome, then GitHub or e-mail through the Join steps, or no account straight to the coach setup, which ends the first run. A signed-in account that already accepted the documents and has a profile skips to the coach setup. Where GitHub supplied a value, the field says so in its hint and the value is only a suggestion, saved with the form: the photo reads "From your GitHub account" in place of the upload hint, and the Display name hint reads "From your GitHub account. How other members see you." until the name is edited, then returns to the plain hint. The provenance is a hint in tertiary ink, not a badge or icon, and goes away as soon as the person changes the field.

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
- **Do** make Follow the member profile's one primary action; once followed it becomes a secondary "Following" button.
- **Do** mark the current People tab with a 2px ink underline on the rule, and keep Members marked on a member's profile and lists.
- **Do** set follower, following and like counts in tabular figures as plain text beside their controls.
- **Do** set chat messages, drafts and corrections in the chat mono, as plain text with their line breaks kept.
- **Do** show a peer correction or a coach check as a word diff in the galley's rose and sage marks, the marks covering words only.
- **Do** keep message actions quiet and under the message, reachable by keyboard and touch, and return focus to the message after an inline panel closes.
- **Do** mark who is speaking with the separation ring in ink around their face, and only while they speak.
- **Do** keep Mute/Unmute (with `Ctrl M`) and Leave in the room's sticky bottom bar at all times, and keep focused controls and opened panels scrolled above it.
- **Do** name the two mutes apart: "Mute for me" silences someone only for you; "Mute for everyone" is a room action in its own ruled group.
- **Do** say a room is never recorded where the microphone is asked for, and show the microphone level in secondary ink.
- **Do** make the sign-in screen's one primary the GitHub button when the community is configured, and "Practise without an account" when it is not.
- **Do** let the splash be skipped by click, Enter, Space or Escape, and show only the still name under reduced motion.
- **Do** say where a prefilled value came from ("From your GitHub account") in its hint, until the person changes it.
- **Do** count the join steps by the path taken: 3 steps after GitHub, 4 by e-mail.

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
- **Don't** rank or sort people by followers or likes, or give a count its own tile.
- **Don't** colour the like heart; liked is the heart filled in the text tone.
- **Don't** render chat text as HTML or markdown, or link-ify it; it is always plain text.
- **Don't** mark a correction with anything but the diff marks: no rose or sage outside them, no "wrong" or "correct", no score.
- **Don't** colour unread: the count is plain mono ink, in the rail and the conversation list, and unread rows are not bolded or tinted.
- **Don't** tell a sender their request was declined; a decline is silent.
- **Don't** colour the speaking ring, the microphone meter or the muted icon; speaking is ink, never pencil, sage or a status colour.
- **Don't** put a pencil primary inside a room; speaking is the main act, so the bar and the person options use secondary and quiet buttons only.
- **Don't** show recording affordances in a room: no record button, recording dot, saved audio or playback; a voice is never recorded.
- **Don't** list one "could not connect" notice per person; name everyone unreachable in one notice.
- **Don't** add a tagline, progress bar or button to the splash, or run it longer than 1.5s plus the fade.
- **Don't** colour the GitHub mark or give another provider a primary; extra ways in are secondary or quiet.
- **Don't** centre the welcome page vertically; its offset keeps the heading still between waiting, error and the buttons.
