# DevTalk

A desktop app for developers who read English well but want to **produce** it: you answer short, realistic work situations (a stand-up update, a code review comment, explaining a bug, an interview question) in 3 to 5 sentences, and an AI coach marks your answer like an editor — edits inline, notes in the margin, a natural B2 rewrite and 2–3 expressions worth keeping. Those expressions come back in a spaced-repetition review (FSRS) and as required expressions in later challenges.

Phase 1 is the solo coach: local, no account. Practice partners and voice rooms come later.

## Requirements

- Linux (the first target; macOS and Windows should work but are untested)
- Node.js 22 or newer and npm 11
- A system keyring for the API key: GNOME Keyring, KWallet or another Secret Service (KeePassXC works too). On desktops Electron does not recognise (sway, i3, Hyprland) DevTalk asks the Secret Service directly.
- Build tools for the native SQLite module: `make`, `g++`, `python3`

## Install

```bash
npm install
```

npm 11 runs dependency install scripts only when they are approved. `package.json` already approves the two DevTalk needs (the SQLite driver and esbuild) under `allowScripts`. If npm still warns about them, approve and rebuild:

```bash
npm install-scripts approve better-sqlite3 esbuild
```

```bash
npm rebuild
```

The Electron binary downloads on first use. To fetch it ahead of time:

```bash
node node_modules/electron/install.js
```

## Get a free coach key

DevTalk uses **Google Gemini** by default because its free tier needs no credit card.

1. Open https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it (it usually starts with `AIza`).
3. Paste it in DevTalk's onboarding, or later in **Settings → Coach**.

The key is stored encrypted by your system keyring, never in plain text. On the free tier Google may use what you send to improve its models.

Claude (Anthropic, paid) is also available in Settings. Ollama (local, free, needs a computer with enough memory) can be chosen too.

## Run

```bash
npm run dev
```

The command-line helpers work without the interface:

```bash
npm run cli -- --set-key --provider gemini
```

```bash
npm run cli -- --smoke
```

`--smoke` asks the coach for one challenge and one feedback and prints them as JSON.

## Use

- **Home** shows your last answer, the next challenge and what is due for review.
- **Practice**: write 3 to 5 sentences, then **Ctrl+Enter**. Press **Esc** to cancel while the coach works.
- **Review**: **Space** reveals the meaning; **1–4** rate Again, Hard, Good, Easy.
- **Ctrl+K** opens the command palette; **Ctrl+1…Ctrl+7** jump to Home, Practice, Review, People, Rooms, Progress and Settings (the sidebar order).

## Tests

```bash
npm test
```

Runs the core (no network), renderer logic and main-process tests. The main-process tests run under Electron's Node so the SQLite module matches.

```bash
npm run test:e2e
```

Builds the app and drives it with Playwright, using a fixture coach (no network, no API calls) and a test keyring, so it never touches your real data or keyring. `tests/e2e/screenshots.spec.ts` also writes screenshots of every screen in both themes to `.impeccable/review/`.

```bash
npm run typecheck
```

## Develop without an API key

Set `DEVTALK_FAKE_LLM=1` to use the fixture coach and `DEVTALK_USER_DATA=<dir>` to keep test data out of your real profile. Both are ignored in packaged builds. The fixture coach still expects a key for cloud providers (any text works).

## Where things live

- Your practice data: `~/.config/devtalk/devtalk.sqlite` (local SQLite)
- API keys: `~/.config/devtalk/api-key-<provider>.bin`, encrypted by the system keyring
- Coach prompts: `prompts/coach.md` and `prompts/challenge.md` — edit them freely; they are read on every request
- Design tokens: `src/renderer/design-system/tokens.css`
- Approved mockups: `docs/design/mockups/` (serve them with the `mockups` entry in `.claude/launch.json`)
- Spec and plans: `docs/superpowers/`

## Project layout

```
src/core       Coach, spaced repetition and domain rules (pure TypeScript)
src/main       Electron main process: SQLite, LLM providers, key vault, IPC
src/preload    The small typed API exposed to the window
src/renderer   React app: design-system/ and screens/
prompts        Runtime prompts
tests          core, renderer, main, contract and e2e tests
```
