# DevTalk Phase 2C (Voice Rooms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any member opens a voice room on the spot; up to 6 members talk live over direct WebRTC audio, with a shared timer and idea card, room roles (host, room moderator) that mute and remove, safety tools and two new badges — on the live Supabase project, every rule proven offline.

**Architecture:** One migration (`0009_rooms.sql`) adds rooms, sessions with a 30 s heartbeat (90 s = gone) and short-lived signalling rows, with RLS, security-definer functions for every room action and readers for the list, the room state and moderator context. The main process keeps the Supabase side (room methods, a room bridge that heartbeats, subscribes and forwards events and signals) and locks Electron permissions to microphone-only. The renderer holds the media: a WebRTC mesh manager (smaller user id offers), the mic meter, and the Rooms screens.

**Tech Stack:** unchanged (Electron 44 / Chromium WebRTC, React 19, TS 6, vitest, Playwright, zod 4, supabase-js 2.117.3 Realtime, PGlite). No new dependencies. STUN: `stun:stun.cloudflare.com:3478`; no TURN.

**Spec:** `docs/superpowers/specs/2026-10-20-devtalk-phase2c-rooms-design.md` · Visual authority: `DESIGN.md` + `.impeccable/design.json`; reuse ruled lists, `Avatar`, `ReportDialog`, `EmptyState`, `Notice`, inline confirmations.

## Global Constraints

- 0001–0008 are live: schema changes only in `supabase/migrations/0009_rooms.sql` (pasted alone); `npm run build:setup-sql`; drift test green. Never edit 0001–0008.
- Voice is never recorded, transcribed or sent to any server; only the user's own mic is analysed, for a level meter.
- At most 6 live people per room; a session is live while `left_at is null and last_seen > now() - interval '90 seconds'`; heartbeat every 30 s; signals deleted after 5 minutes; signal payload ≤ 16 384 bytes; ≤ 600 signals per minute per person; ≤ 10 rooms created per person per 24 h; one live room per person.
- Title 3–60 characters (trimmed); themes `standup | code_review | interview | free` (labels Stand-up, Code review, Interview, Free talk); level A2–C2 or null; timer 60 or 90 s only.
- Realtime: subscribe to INSERT and UPDATE only (never DELETE).
- Electron grants only `media` with audio only, only to the app's own page; everything else is denied.
- Room host badge: 5+ rooms created where someone else had a session. Active speaker: 10+ sessions of 5+ minutes overlapping another person's session by 5+ minutes. Community group.
- New `LEGAL_VERSION` = implementation date (suffix `.N` if that date was already used).
- Unit tests always with `--maxWorkers=2`. Do not update the agents view. Copy in simple English (B1). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Check `git branch --show-current` is `feat/phase2c-rooms` before every commit.

## Review Focus

1. **Ghost seats and stale rooms** — a crashed app keeps no seat after 90 s, a room with only dead sessions leaves the list, a host who drops hands the role on (room moderator first, else earliest live member). Tests in Task 2.
2. **Abuse of room power** — a member muting or removing the host, a room moderator removing another moderator, a removed person rejoining through the API, a blocked person seeing or joining the room, a block made inside a room (the blocker leaves; blocking never kicks the other person). Tests in Task 2.
3. **Signal privacy** — signals (they hold IP addresses) readable only by the recipient, refused between non-members or a blocked pair, gone after 5 minutes; camera, screen and other permissions denied. Tests in Tasks 2 and 4.
4. **Connection lifecycle** — a peer that never answers shows "Could not connect" after 20 s without stopping the others; glare (two offers) never breaks a pair; leaving on quit, sign-out and navigation; reconnect after the network returns. Tests in Tasks 4 and 5.
5. **Hostile input** — blank or 61-character titles, emoji/RTL titles shown as text, timer values other than 60/90, a 16 385-byte payload, the 7th person. Tests in Tasks 2 and 4.

---

### Task 1: Core — room types, themes, idea cards, timer

**Files:** Create `src/core/social/rooms.ts` · Test `tests/core/rooms.test.ts`

**Interfaces — Produces:**
```ts
const ROOM_MAX = 6; const ROOM_TITLE_MIN = 3; const ROOM_TITLE_MAX = 60; const ROOM_HEARTBEAT_MS = 30_000;
const ROOM_CONNECT_TIMEOUT_MS = 20_000; const ROOM_SIGNAL_MAX_BYTES = 16_384;
const ROOM_THEMES = ['standup', 'code_review', 'interview', 'free'] as const; type RoomTheme
const ROOM_THEME_LABELS: Record<RoomTheme, string>   // 'Stand-up' | 'Code review' | 'Interview' | 'Free talk'
const ROOM_TIMERS = [60, 90] as const; type RoomTimer = 60 | 90
const ROOM_CARDS: Record<RoomTheme, readonly string[]>   // ≥ 8 short B1 prompts each, developer situations
type RoomRole = 'host' | 'moderator' | 'member'
type RoomSignalKind = 'offer' | 'answer' | 'candidate' | 'bye'
interface RoomDraft { title: string; theme: RoomTheme; level: Level | null }
interface RoomPerson { id: string; displayName: string; hasAvatar: boolean; mascot: MascotId | null; level: Level; role: RoomRole }
interface LiveRoom { id: string; title: string; theme: RoomTheme; level: Level | null; hostName: string; people: Omit<RoomPerson, 'level' | 'role'>[] }
interface RoomState { id: string; title: string; theme: RoomTheme; level: Level | null; hostId: string; endedAt: string | null;
  timer: { startedAt: string; seconds: RoomTimer } | null; card: number;
  me: { live: boolean; removed: boolean; role: RoomRole; muteRequestedAt: string | null }; people: RoomPerson[] }
type RoomLiveEvent = { kind: 'changed' } | { kind: 'signal'; from: string; signal: RoomSignalKind; payload: string } | { kind: 'online' | 'offline' }
interface RoomReportContext { title: string; theme: RoomTheme; hostName: string | null; createdAt: string;
  people: { name: string | null; joinedAt: string; leftAt: string | null }[] }
roomTitle(raw: string): string | null            // trimmed; null outside 3–60
cardFor(theme: RoomTheme, n: number): string     // ROOM_CARDS[theme][n mod length], n ≥ 0
timerLeft(timer: RoomState['timer'], now: Date): number | null   // whole seconds left, 0 when over, null without a timer
```

- [ ] **Step 1: Failing tests:** `roomTitle('  Daily stand-up ')` → `'Daily stand-up'`; `'ab'` and 61 chars → null, 60 kept, emoji and RTL kept; `cardFor('standup', 0)` equals the first card and `cardFor('standup', len)` wraps; every theme has ≥ 8 cards and a label; `timerLeft` at start = 60, after 59.2 s = 1, after 61 s = 0, null timer → null.
- [ ] **Step 2: Run** `npx vitest run --project core --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS + typecheck. **Step 5: Commit** `feat(core): room types, themes, idea cards and timer`.

---

### Task 2: Migration 0009 — rooms, sessions, signals, roles and readers

**Files:** Create `supabase/migrations/0009_rooms.sql`, `tests/supabase/rooms.test.ts` · Regenerate `supabase/setup.sql`; update the setup RLS table count (+3)

**Interfaces — Produces (SQL):** tables per spec §2 (`rooms` with `created_by`, `host`, `timer_started_at`, `timer_seconds`, `card`; `room_sessions` with `role`, `last_seen`, `left_at`, `removed`, `mute_requested_at`; `room_signals`). Functions (security definer, `search_path = public`, revoked from public/anon, granted to authenticated): `create_room(title text, theme text, level text) returns uuid`, `join_room(room uuid)`, `leave_room(room uuid)`, `room_heartbeat(room uuid) returns boolean` (false = you are no longer live there), `make_room_moderator(room uuid, member uuid)`, `remove_room_moderator(room uuid, member uuid)`, `pass_host(room uuid, member uuid)`, `mute_member(room uuid, member uuid)`, `remove_from_room(room uuid, member uuid)`, `end_room(room uuid)`, `start_timer(room uuid, seconds int)`, `stop_timer(room uuid)`, `next_card(room uuid)`, `live_rooms() returns table(id uuid, title text, theme text, level text, host_name text, people jsonb, created_at timestamptz)` (people: `[{id, name, hasAvatar, mascot}]`), `room_state(room uuid) returns json` (null when the caller never had a session there; `people` only while the caller is live), `room_report_context(report bigint) returns json` (moderators only, else null). Internal `room_session_live(...)` helper and host-inheritance routine used by leave/heartbeat. RLS: `rooms`/`room_sessions` select for live members of that room; `room_signals` select by recipient, insert by sender when both are live in the room and not blocked; signal limit trigger (600/min) and payload size check. Trigger on `blocks`: the blocker's live sessions in rooms where the blocked person is live are closed. `profile_badges` replaced (adds `room_host`, `active_speaker` after `diff_master`). Guarded `alter publication supabase_realtime add table rooms, room_sessions, room_signals`.

Errors (message text the app maps): `room limit reached` (11th room in 24 h), `room is full`, `not allowed` (42501: removed, blocked, not live, wrong role), `room title is not valid`, `signal limit reached`.

- [ ] **Step 1: Failing tests** (each named): create makes you host and live, and `live_rooms` shows it to another member; a 3- and 60-char title pass, 2/61 chars or an unknown theme fail; the 11th room in 24 h fails `room limit reached`; the 7th live person fails `room is full`, and a session silent for 91 s frees the seat and an all-dead room leaves `live_rooms` (Review Focus 1); joining another room closes your first session; blocked either way: the room is hidden from `live_rooms` and `join_room` fails; a block made inside a room closes the blocker's session, not the blocked person's (Review Focus 2); only the host makes/unmakes moderators and passes host; host or room moderator mutes and removes, a member cannot, nobody mutes or removes the host, a moderator cannot remove another moderator; a removed person cannot rejoin; host leaving (or silent 91 s, applied by a heartbeat) passes host to the oldest room moderator, else the earliest live member; the last person leaving ends the room; `end_room` only by the host; timer accepts 60/90 only and any live member can start/stop it; `next_card` increments; `room_state` shows `me.removed` to a removed person and no people; signals: only between live members of the same room, only the recipient reads them, refused for a blocked pair, a 16 385-byte payload fails, the 601st in a minute fails `signal limit reached`, and a heartbeat deletes signals older than 5 minutes (Review Focus 3); anon reads nothing and cannot call any function; `room_report_context` returns title/theme/host/people times to moderators and null to others; account deletion removes created rooms, sessions and signals; Room host at 5 rooms where someone else had a session (4 → no badge); Active speaker at 10 overlapping 5-minute sessions (9 → no badge).
- [ ] **Step 2: Run** `npx vitest run --project supabase --maxWorkers=2` → FAIL. **Step 3: Write 0009.** **Step 4: Run** → PASS; `npm run build:setup-sql`; setup/drift tests pass. **Step 5: Commit** `feat(supabase): voice rooms, roles, signals and badges (0009)`.

---

### Task 3: Backend — room methods and room events (fake + Supabase)

**Files:** Modify `src/main/social/backend.ts`, `fake-backend.ts`, `supabase-backend.ts`, `errors.ts` · Test `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts`

**Interfaces — Produces:**
```ts
SocialBackend += {
  liveRooms(): Promise<LiveRoom[]>;
  createRoom(draft: RoomDraft): Promise<string>;
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  roomHeartbeat(roomId: string): Promise<boolean>;
  roomState(roomId: string): Promise<RoomState | null>;
  sendRoomSignal(roomId: string, to: string, signal: RoomSignalKind, payload: string): Promise<void>;
  makeRoomModerator(roomId: string, userId: string): Promise<void>;
  removeRoomModerator(roomId: string, userId: string): Promise<void>;
  passHost(roomId: string, userId: string): Promise<void>;
  muteMember(roomId: string, userId: string): Promise<void>;
  removeFromRoom(roomId: string, userId: string): Promise<void>;
  endRoom(roomId: string): Promise<void>;
  setRoomTimer(roomId: string, seconds: RoomTimer | null): Promise<void>;   // null = stop
  nextCard(roomId: string): Promise<void>;
  roomReportContext(reportId: number): Promise<RoomReportContext | null>;
  /** Live changes of one room and the signals addressed to the caller; returns the unsubscribe. */
  subscribeRoom(roomId: string, onEvent: (e: RoomLiveEvent) => void): () => void;
}
FakeSocialBackend += { actAsForTest(userId: string, act: (b: SocialBackend) => Promise<unknown>): Promise<unknown> }   // runs as another member; events follow
seed 'people' += a live room "Stand-up practice" (theme standup, level B1) hosted by Bia with Caio inside; seeded people stay live
```
Supabase `subscribeRoom`: one channel; `postgres_changes` INSERT and UPDATE on `rooms` (`id=eq.<room>`), `room_sessions` (`room_id=eq.<room>`) → `{kind:'changed'}`; `room_signals` (`recipient=eq.<me>`, only rows of this room) → `{kind:'signal', from, signal, payload}`; status → `online`/`offline`. Uses the existing `openChannel` test seam. `mapSupabaseError`: `room limit|signal limit` → `rate_limited`.

- [ ] **Step 1: Failing tests:** fake mirrors the Task 2 rules the app relies on (cap, one room at a time, roles, removal, block hiding, signals only to the recipient, badges) and delivers room events only to members of that room and signals only to their recipient, nothing after sign-out; the seed shows Bia's room; `actAsForTest` lets Bia mute and remove Rian; Supabase calls the right rpcs/params, maps `live_rooms`/`room_state`/context, registers INSERT/UPDATE only with the right filters, ignores signals of other rooms, unsubscribes on sign-out.
- [ ] **Step 2: Run** `npx vitest run --project main --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): rooms in the social backends`.

---

### Task 4: Main — IPC, room bridge, permissions, fake media

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/social-handlers.ts`, `src/main/ipc/handle.ts`, `src/main/security.ts`, `src/main/index.ts`, `src/main/app-context.ts`, `src/preload/api.ts` · Create `src/main/social/room-live.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/room-live.test.ts`, `tests/main/security.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** channels `rooms:list {}`, `rooms:create RoomDraft` → id, `rooms:join {roomId}`, `rooms:leave {roomId}`, `rooms:state {roomId}`, `rooms:signal {roomId, to, signal, payload}`, `rooms:makeModerator|removeModerator|passHost|mute|remove {roomId, userId}`, `rooms:end {roomId}`, `rooms:timer {roomId, seconds: 60|90|null}`, `rooms:nextCard {roomId}`, `moderation:roomContext {reportId}` (moderators); event `ROOM_EVENT = 'room:event'` (`RoomLiveEvent`); API `rooms.*`, `rooms.onEvent(cb)`, `moderation.roomContext`. `createRoomLive({ backend, emit, heartbeatMs?, now? })` → `{ enter(roomId: string): void; exit(): Promise<void>; current(): string | null }` — enter subscribes and heartbeats every 30 s (a `false` heartbeat emits `changed` and stops); exit leaves and unsubscribes; never throws. `create`/`join` call `enter`; `leave`, sign-out, account deletion and `before-quit` call `exit`. `allowPermission(permission: string, details: { mediaTypes?: string[] }, requestingUrl: string, appUrl: string): boolean` in `security.ts`, wired to `setPermissionRequestHandler` and `setPermissionCheckHandler`. Dev/e2e only: `DEVTALK_FAKE_MEDIA=1` adds the Chromium switch `use-fake-device-for-media-stream` only (never when packaged; `use-fake-ui-for-media-stream` would bypass the permission handler).

- [ ] **Step 1: Failing tests:** zod refuses a 2/61-char title, an unknown theme, `seconds: 30`, a 16 385-byte payload and an unknown signal kind (`validation`; Review Focus 5); limit copy "You can create up to 10 rooms a day. Try again tomorrow." and "This room is full."; `moderation:roomContext` is moderators only; room-live heartbeats on schedule (fake clock), forwards only this room's events and the caller's signals, `exit` leaves and nothing arrives after it, a `false` heartbeat stops (Review Focus 4); `allowPermission` allows `media` with `['audio']` from the app URL and denies `['audio','video']`, `display-capture`, `geolocation`, `notifications` and any foreign URL (Review Focus 3); preload maps every method and `onEvent`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run --maxWorkers=2` + typecheck → PASS. **Step 5: Commit** `feat(main): room IPC, room bridge and microphone-only permissions`.

---

### Task 5: Renderer — WebRTC mesh and mic meter

**Files:** Create `src/renderer/lib/mesh.ts`, `src/renderer/lib/room-call.ts`, `src/renderer/lib/mic.ts` · Test `tests/renderer/mesh.test.ts`, `tests/renderer/room-call.test.ts`

**Interfaces — Produces:**
```ts
// mesh.ts (pure)
meshPlan(myId: string, live: string[], peers: string[]): { offer: string[]; await: string[]; drop: string[] }   // the smaller id offers
// room-call.ts
interface PeerLike { /* the RTCPeerConnection subset used: createOffer, createAnswer, setLocalDescription,
  setRemoteDescription, addIceCandidate, addTrack, close, connectionState, onicecandidate, ontrack, onconnectionstatechange */ }
type PeerState = 'connecting' | 'connected' | 'failed'
class RoomCall {
  constructor(o: { myId: string; stream: MediaStream; send(to: string, signal: RoomSignalKind, payload: string): void;
    createPeer(): PeerLike; onPeer(id: string, state: PeerState, stream: MediaStream | null): void; timeoutMs?: number });
  sync(live: string[]): void;                    // follows meshPlan; drops people who left (sends 'bye')
  handle(from: string, signal: RoomSignalKind, payload: string): Promise<void>;
  setMuted(muted: boolean): void;                // track.enabled; never stops the stream
  close(): void;                                  // bye to all, closes peers, stops the mic
}
const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }]
// mic.ts
openMic(): Promise<MediaStream>                  // audio only: echoCancellation, noiseSuppression, autoGainControl
levelMeter(stream: MediaStream, onLevel: (0..1) => void): () => void   // AnalyserNode; nothing stored
```

- [ ] **Step 1: Failing tests** with an in-memory fake `PeerLike` pair that relays descriptions and candidates: `meshPlan` — smaller id offers, larger waits, people who left are dropped; two `RoomCall`s connect through `send`/`handle`; three calls form a full mesh with one connection per pair; simultaneous offers (glare) still end with one connected pair; a peer that never answers reports `failed` after `timeoutMs` while the others stay connected (Review Focus 4); `bye` and `sync` without that person close the pair; `setMuted(true)` disables the track; `close` sends `bye` to everyone.
- [ ] **Step 2: Run** `npx vitest run --project renderer --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS + typecheck. **Step 5: Commit** `feat(renderer): WebRTC mesh for rooms`.

---

### Task 6: Renderer — Rooms screens, room view, moderation context

**Files:** Modify `src/renderer/lib/router.ts` (`#/rooms/<uuid>`), `src/renderer/app/App.tsx` (Rooms screen; palette "Go to Rooms" keywords; Ctrl+M only inside a room), `src/renderer/app/Rail.tsx` (no "Later"), `src/renderer/screens/ModerationScreen.tsx` · Create `src/renderer/screens/RoomsScreen.tsx`, `RoomView.tsx`, `RoomPeople.tsx` · Remove the rooms entry of `LaterScreen` · CSS in `screens.css` · Test `tests/renderer/router.test.ts`, `tests/e2e/rooms.spec.ts`

**Interfaces — Produces:** list (title, theme label, level, avatars, "n / 6", **Join** or "Full"; empty state copy from the spec), **Create a room** form, pre-join mic check with `levelMeter` (**Join room** / **Cancel**; "No microphone found." / how to allow the microphone), room view per spec §4 (people with role labels, speaking ring from each remote stream's level, muted icon; per-person menu by role (Mute for me, Block, Report for everyone; Mute, Remove, Make moderator for host and room moderator; Make host for the host); idea card with **Next card**; timer **60 s** / **90 s** / **Stop** with `timerLeft`; bottom bar **Mute/Unmute** (Ctrl+M), **Leave**, **End room** (host); notices joined/left, removed, muted by host, could not connect, reconnecting). Leaving the route leaves the room. Moderation: a room report shows the room context.

- [ ] **Step 1: Failing tests:** router parses `#/rooms/<uuid>`; e2e (`social: 'people'`, `DEVTALK_FAKE_MEDIA=1`): the list shows Bia's room with "2 / 6", joining passes the mic check, the room shows Bia (Host) and Caio and the card; Next card and a 60 s timer show for everyone; Mute/Unmute and Ctrl+M toggle; Bia mutes Rian (hook) → notice and muted; Rian creates a room; Ana joins (hook); Rian makes Ana room moderator (label shows); Rian removes Ana; Ana's rejoin (hook) fails `not allowed`; a peer who never answers shows "Could not connect to Bia" after the timeout (shortened by env `DEVTALK_ROOM_TIMEOUT_MS`); Leave returns to the list; a room title with `<b>x</b>` and RTL shows as text; a report from the room shows the context to a moderator.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the spec → PASS. **Step 5: Commit** `feat(renderer): Rooms, the room view and room moderation`.

---

### Task 7: Documents — privacy, terms, conduct, product

**Files:** `docs/legal/privacy.md`, `docs/legal/terms.md`, `docs/legal/code-of-conduct.md`, `src/core/social/types.ts` (`LEGAL_VERSION`), `tests/core/social.test.ts`, `PRODUCT.md`, `README.md` (paste 0009, check the publication)

- [ ] **Step 1: Failing test:** the core test pins the new `LEGAL_VERSION`. **Step 2: Run** → FAIL. **Step 3: Write** (voice never recorded, transcribed or relayed; people in the room see your IP; signals kept at most 5 minutes; who was in a room and when, for reports and badges; Cloudflare STUN; room roles, removal and muting; Room host and Active speaker). **Step 4: Run** → PASS. **Step 5: Commit** `docs: privacy and terms for voice rooms`.

---

### Task 8: E2E, screenshots, design review, DESIGN.md

- [ ] **Step 1:** screenshots of the room list, the create form, the mic check and a room (host view with the card and a running timer), both themes × 1440/960; contact sheets; fix in one batch; recheck once; impeccable detector.
- [ ] **Step 2:** impeccable finish reviewer, act on fixes; documenter extends DESIGN.md / design.json (room list, room view, people, card, timer, control bar).
- [ ] **Step 3:** `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e` → PASS. **Step 4: Commit** `test: rooms end to end; docs(design): rooms`.

---

### Task 9: Go live (guided, after the final code review)

- [ ] Copy page for `supabase/migrations/0009_rooms.sql`; the user pastes it alone ("Success. No rows returned") and checks `supabase_realtime` lists `rooms`, `room_sessions`, `room_signals`.
- [ ] The user re-accepts the documents and tests with two accounts on two computers (ideally on different networks): create, join, hear each other, mute, a timer, a card, make moderator, remove.
