---
version: 1
slug: "src-renderer"
primary_target: "src/renderer"
related_targets: ["docs/design/mockups"]
---

# Surface brief: DevTalk app (renderer)

Scope: the whole desktop app UI (sidebar shell, Home, Practice, Feedback, Review, Progress, Settings; Rooms and People in phase 2). Visitor mode: Operate.

Audience and job: a B1 developer in a short daily session (10–20 min) who reviews due expressions, writes 3–5 sentences for one dev situation and reads the coach's corrections. Key states: waiting for the coach (seconds, cancellable), empty (no reviews due, first run), error (no key, model rejected, offline).

Constraints: brief-pinned dark default + light theme, sans UI, monospace diffs, red removed / green added without "wrong" wording, expression cards with type badges, sidebar + Ctrl+K, WCAG AA, reduced motion.

## Direction contract

THESIS: Every answer is a galley and the coach marks it like an editor in blue pencil — edits, not grades. It refuses the category default: a grey dashboard of stat cards with one violet accent.

OWN-WORLD: graphite ground (#16181D) with a raised galley sheet (#20232B) and 1px rules (#2B2F39); ink #E8E6E1. Non-repro pencil blue (#7FB2E5) is the coach's voice only: proof carets, margin notes, the primary action. Deletions struck in dusty rose, insertions in sage green, both desaturated. Public Sans for the interface; JetBrains Mono for the galley (the learner's text with marks), expressions and timers. Light theme: cool white sheet on pale grey, darker pencil.

STORY: the learner sees what to do next, writes, then reads their own words marked up with notes in the margin, and leaves with 2–3 expressions that will come back.

FIRST VIEWPORT: Home — sidebar left; main column shows the last answer as a marked galley with margin notes; beneath it the next challenge with the primary "Write it" action; a right column lists expressions due with "Review".

FORM: Galley Proof, #1 on my ordered list (IMPECCABLE’S PICK, chosen by the user over the rolled #6). seed: none (unavailable). Signature move: blue-pencil margin notes aligned to the line they mark. Translation: the sketch's serif galley is set in monospace because the brief pins monospace diffs.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
