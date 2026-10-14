# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app; the UI is web technology. Linux is the first target.)

## Users

Developers at an intermediate English level (B1) who read technical English comfortably but struggle to produce it: they reuse the same simple vocabulary and take too long to build complex sentences. The first user is a Computer Science student on Linux who studies Python, Java and C++, aiming for B2 in speaking and writing for real work situations.

## Product Purpose

DevTalk makes developers practise English by producing it, not consuming it. The app proposes a real developer situation, the learner answers in 3 to 5 sentences, and an AI coach returns direct corrections, a natural B2 rewrite and 2–3 reusable expressions. Success is the learner reaching B2 fluency and naturalness in real work situations.

Recommended rhythm (confirmed with the user): one short session a day, 10–20 minutes — due reviews plus one or two challenges.

## Positioning

The loop closes on the learner's own output: corrections are shown as a code-style diff of what they wrote, and the new expressions enter an FSRS spaced-repetition queue and come back as required expressions in later challenges, where the coach checks whether they were used correctly. Practice partners (phase 2) are for people; the AI is for correction.

## Operating Context

- Challenge categories: daily stand-up update, code review (polite disagreement, requesting changes, justifying a choice), explaining a bug's cause, technical interview.
- Review uses Again / Hard / Good / Easy ratings.
- Later phases: 1:1 chat with peer corrections, scheduled voice rooms (up to 6 people, timed 60–90 s turns), solo timed speaking with local transcription, a global shortcut to send any selected text for feedback.
- The user's practice text never leaves the machine except to the chosen LLM provider.

## Capabilities and Constraints

- Phase 1 is solo, local and account-free: onboarding, Home, challenge, written answer, feedback, review, progress, settings.
- Every correction carries one category from a fixed list; the app counts recurring mistakes.
- The LLM takes seconds to answer: progress must be visible and cancellable.
- Navigation: sidebar (Home, Practice, Review, People, Rooms, Progress, Settings), a Ctrl+K command palette and keyboard shortcuts.
- Every screen has empty, loading and error states.
- No code, brand or assets from third parties.

## Brand Commitments

- A developer tool, not a children's app: focus, calm and precision, in the spirit of Linear, Raycast and VS Code. No mascots, no gamification.
- Dark theme by default with a light theme option; colors, spacing, type and radii defined once as tokens.
- Readable sans-serif for the interface, monospace for diffs; comfortable line height because the user reads a lot of English.
- Corrections shown as a diff: removed in red, added in green, never labelled "wrong".
- Expressions shown as cards with a type badge (chunk, phrasal verb, collocation).
- Interface copy in simple English.
- Exception to "no third-party brands or assets" (confirmed 2026-10-14): technology logos from Simple Icons (CC0) may identify a profile's stack, drawn in one colour (the text tone), never as decoration.

## Evidence on Hand

None yet: no logos, testimonials, users or metrics. Do not invent any.

## Product Principles

1. Produce, don't consume — every screen leads toward writing or speaking.
2. Making mistakes must feel safe — corrections read as edits, not grades.
3. Useful alone — the solo coach is complete without any community.
4. One next step — the app always shows what to do now, not a wall of statistics.

## Accessibility & Inclusion

WCAG 2.1 AA contrast, visible focus, full keyboard navigation, and respect for reduced-motion preferences. The learner is a non-native English reader: plain words, comfortable measure and line height.

## Things That Would Feel Wrong (confirmed)

A Home that becomes a metrics dashboard; a generic grey SaaS template with no identity; loud or neon accents that tire a reading session; corrections that look like a graded test ("red = wrong").
