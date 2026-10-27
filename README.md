# DevTalk

A desktop app for developers who read English well but want to **produce** it: you answer short, realistic work situations (a stand-up update, a code review comment, explaining a bug, an interview question) in 3 to 5 sentences, and an AI coach marks your answer like an editor — edits inline, notes in the margin, a natural B2 rewrite and 2–3 expressions worth keeping. Those expressions come back in a spaced-repetition review (FSRS) and as required expressions in later challenges.

Phase 1 is the solo coach: local, no account. The community (profiles, people, private chat and voice rooms) is optional and needs an account: sign in with a code sent to your e-mail or with GitHub.

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

## Community (Supabase)

The community (accounts, profiles, blocks, reports, moderation) runs on a free Supabase project. The window never talks to the network: the main process holds the Supabase client and keeps the session encrypted with the system keyring.

1. **Settings.** Copy `.env.example` to `.env` and fill in the project URL and the **publishable** key (Project Settings › API). Never put the secret / service_role key there; the app refuses to start the community with it.
2. **E-mail codes.** Supabase only sends e-mail to your own team until you set up SMTP (Authentication › Emails › SMTP Settings). The "Confirm sign up" and "Magic link or OTP" templates must show `{{ .Token }}` so people get a code, not a link.
3. **Database.** Open SQL Editor › New query, paste all of `supabase/setup.sql`, and click Run. It creates the tables, the row-level security rules and the private `avatars` bucket. Regenerate it after changing a migration with `npm run build:setup-sql`.
4. **Delete-account function.** Edge Functions › Deploy a new function › Via editor, name it `delete-account`, paste `supabase/functions/delete-account/single-file.ts` (regenerate with `npm run build:edge`) and keep "Verify JWT" on. The service-role key it needs already exists in the function's environment and never leaves the server.
5. **Moderators.** Sign in once in the app, then run in SQL Editor: `insert into moderators (user_id) select id from auth.users where email = 'you@example.com';`
6. **Profile extras (badges, practice graph, banners).** A project set up before 2026-10-15 pastes only `supabase/migrations/0004_profile_extras.sql` in a new query and clicks Run (new projects get it inside `setup.sql`). Then deploy the `delete-account` function again from `single-file.ts`, so deleting an account also removes the banner. The Creator badge is given once in SQL Editor: `insert into badge_grants (user_id, badge, granted_by) select id, 'creator', id from auth.users where email = 'you@example.com';`
7. **People (member list, follows, likes).** A project set up before 2026-10-16 pastes only `supabase/migrations/0005_review_fixes.sql` (if not yet), then `supabase/migrations/0006_people.sql` and `supabase/migrations/0007_people_review.sql`, each alone, in a new query. Use the matching app build only after they are in.
8. **Private chat.** A project that already ran 0001–0007 pastes only `supabase/migrations/0008_chat.sql` in a new query and clicks Run. It also adds the chat tables to Realtime (Database › Publications › `supabase_realtime` should list `conversations`, `messages` and `corrections`). Then check with a second account: send a request, accept it, and see messages arrive live.
9. **Voice rooms.** A project that already ran 0001–0008 pastes only `supabase/migrations/0009_rooms.sql` alone in a new query and clicks Run. It also adds the room tables to Realtime (Database › Publications › `supabase_realtime` should list `rooms`, `room_sessions` and `room_signals`). Then check with two accounts on two computers, ideally on different networks: open a room on one, join it from the other, and talk. Voice goes directly between the computers with no relay server, so a call can fail on some networks.
10. **GitHub sign-in.** It needs no database change, only settings in two dashboards, done once:
    - On GitHub, open Settings › Developer settings › OAuth Apps › New OAuth App. Application name: DevTalk. Homepage URL: any address, for example the project page. Authorization callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback` (the project ref is the first part of your Supabase project URL). Register the app, then click **Generate a new client secret**.
    - In Supabase, open Authentication › Sign In / Providers › GitHub, switch it on, paste the **Client ID** and the **Client Secret**, and save. The Client Secret stays in Supabase: never put it in `.env`, in the repository or in a chat.
    - In Supabase, open Authentication › URL Configuration › Redirect URLs and add exactly these three addresses (the app uses the first one that is free while you sign in): `http://127.0.0.1:53682/callback`, `http://127.0.0.1:53683/callback` and `http://127.0.0.1:53684/callback`.
    - Run the app and test **Continue with GitHub** (on the welcome screen at the first start, or in People › Join): your browser opens, you approve, and you come back to DevTalk with a profile suggested from your GitHub name and photo. The e-mail code sign-in now uses PKCE too, so test it once as well. The terms, privacy policy and code of conduct have a new version (2026-10-26), so every member accepts them again.

Check it end to end (a zenity dialog asks for your e-mail and the code):

```bash
npm run cli -- --social-smoke
```

```bash
npm run cli -- --social-smoke --check-moderator
```

Free projects pause after 7 days without use; restore them from the Supabase dashboard. Set `DEVTALK_FAKE_SOCIAL=1` (or `=moderation`, signed in as a seeded moderator) to work on the community screens without a server.

## Tests

```bash
npm test
```

Runs the core (no network), renderer logic, Supabase (migrations and row-level security on an in-memory Postgres) and main-process tests. The main-process tests run under Electron's Node so the SQLite module matches.

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
- Community session: `~/.config/devtalk/social-session.bin`, encrypted by the system keyring
- What the practice sync already sent (day counts and milestones, never text): `~/.config/devtalk/practice-sync.json`
- Database migrations and the delete-account function: `supabase/`
- Legal documents shown in the app: `docs/legal/`
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
