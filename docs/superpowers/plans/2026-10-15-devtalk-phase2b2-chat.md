# DevTalk Phase 2B.2 (Private Chat with Corrections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members open private 1:1 conversations by accepted request, chat live, correct each other's messages as diffs (with Thanks and the Diff master badge), and check their own message with the coach before sending — on the live Supabase project, every rule proven offline.

**Architecture:** One migration (`0008_chat.sql`) adds conversations, messages, corrections, reads and report snapshots with RLS, security-definer functions for requests/responses/deletes/thanks/listing/report context, triggers for limits, snapshots and the practice graph, and adds the chat tables to the Realtime publication. The main process gains chat methods on `SocialBackend`, a live bridge (Realtime → `chat:event` to the window) and a coach check; the renderer adds a Messages screen, a rail item with unread count, corrections and the composer.

**Tech Stack:** unchanged (Electron 44, React 19, TS 6, vitest, Playwright, zod 4, supabase-js 2.117.3 incl. its Realtime client, PGlite). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-devtalk-phase2b2-chat-design.md` · Visual authority: `DESIGN.md` + `.impeccable/design.json`; reuse `Galley`/diff marks for corrections, ruled lists, `Avatar`, `ReportDialog`, `EmptyState`.

## Global Constraints

- 0001–0007 are live: schema changes only in `supabase/migrations/0008_chat.sql` (pasted alone); `npm run build:setup-sql`; drift test green. Never edit 0001–0007.
- Only the two participants read a conversation, its messages and corrections; moderators only through `report_context(report_id)`; anon nothing; blocked pairs nothing (data kept).
- Limits: message and correction text 1–2 000 characters (trimmed, not blank); 10 new requests, 500 messages, 200 corrections per person per 24 h; re-request after a decline only after 30 days (silent before).
- Report snapshot: the reported message and the 10 before it, copied at report time; survives deletes; sender set null on account deletion.
- Diff master: 25+ corrections authored that received Thanks; community group.
- Graph: `practice_days.corrections` (0–2 000); points = answers × 5 + reviews + corrections × 5; active day if any > 0.
- Messages render as plain text (never HTML/markdown); newlines kept.
- The coach check sends only the user's own draft to their chosen LLM and saves nothing locally.
- New `LEGAL_VERSION` = implementation date (suffix `.N` if that date was already used).
- Unit tests always with `--maxWorkers=2`. Keep the agents view current. Copy in simple English (B1). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Privacy leaks** — a third member, a moderator outside a report, a blocked participant or anon reading conversations, messages or corrections, directly, through `my_conversations`, or through Realtime events reaching the window. Tests in Tasks 2 and 3.
2. **Request abuse** — the 11th request in a day, re-requesting within 30 days of a decline (must look like success and do nothing), requesting yourself, a blocked or suspended member, or messaging a pending/declined conversation. Tests in Task 2.
3. **Message lifecycle** — delete erases text and its corrections but report snapshots keep it; account deletion cascades; correcting a deleted or your own message; Thanks by anyone but the sender. Tests in Task 2.
4. **Live updates** — offline/reconnect with no duplicate or missing messages, events for other conversations or after sign-out never reaching the window. Tests in Tasks 3 and 4.
5. **Hostile text** — 2 001 characters, blank, emoji, RTL, newlines, `<script>`/markdown shown as text; a failing coach check never blocks sending. Tests in Tasks 4, 5 and 6.

---

### Task 1: Core — chat types, limits and graph corrections

**Files:** Create `src/core/social/chat.ts` · Modify `src/core/progress/practice.ts`, `src/renderer/lib/graph.ts` · Test `tests/core/chat.test.ts`, `tests/core/profile-extras.test.ts`, `tests/renderer/graph.test.ts`

**Interfaces — Produces:**
```ts
// chat.ts
const CHAT_TEXT_MAX = 2000; const CHAT_PAGE = 50;
type ConversationStatus = 'pending' | 'accepted' | 'declined'
interface ConversationSummary { id: string; other: { id: string; displayName: string; hasAvatar: boolean; mascot: MascotId | null };
  status: ConversationStatus; requestedByMe: boolean; preview: string | null /* null = deleted */; lastMessageAt: string | null; unread: number }
interface ChatCorrection { id: number; messageId: number; authorId: string; corrected: string; createdAt: string; thanked: boolean }
interface ChatMessage { id: number; conversationId: string; senderId: string; body: string; createdAt: string; deleted: boolean; corrections: ChatCorrection[] }
type ChatEvent = { kind: 'message' | 'correction' | 'conversation'; conversationId: string }
interface ReportedMessage { messageId: number; senderName: string | null; body: string; createdAt: string; reported: boolean }
chatText(raw: string): string | null   // trimmed; null when blank or > 2000
// practice.ts
DayActivity += { corrections?: number }; graphLevel counts corrections × 5; streaks counts a day with only corrections
// graph.ts
cellLabel adds ", N correction(s)" only when corrections > 0
```

- [ ] **Step 1: Failing tests:** `chatText('  hi ')` → `'hi'`, blank → null, 2 001 chars → null, 2 000 kept, newlines kept; graph level with 2 corrections = 10 points → level 2; a day with only corrections keeps a streak; `cellLabel` "14 Oct: 0 answers, 0 reviews, 1 correction".
- [ ] **Step 2: Run** `npx vitest run --project core --project renderer --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS + typecheck. **Step 5: Commit** `feat(core): chat types and corrections in the practice graph`.

---

### Task 2: Migration 0008 — chat tables, rules and readers

**Files:** Create `supabase/migrations/0008_chat.sql`, `tests/supabase/chat.test.ts` · Regenerate `supabase/setup.sql`; update the setup RLS table count

**Interfaces — Produces (SQL):** tables per spec §2; functions (security definer, revoked from public/anon, granted to authenticated): `request_conversation(target uuid, body text) returns uuid`, `respond_conversation(conversation uuid, accept boolean)`, `delete_message(message bigint)`, `thank_correction(correction bigint)`, `mark_read(conversation uuid)`, `my_conversations() returns table(id uuid, other_id uuid, other_name text, other_has_avatar boolean, other_mascot text, status text, requested_by_me boolean, preview text, last_message_at timestamptz, unread int)`, `report_context(report bigint) returns table(message_id bigint, sender_name text, body text, created_at timestamptz, reported boolean)` (moderators only; empty otherwise); RLS select on conversations/messages/corrections for participants only (active, not blocked); direct insert into `messages` (accepted conversation) and `corrections`; limit triggers; report snapshot trigger; corrections → `practice_days.corrections` trigger; `practice_streak_values` and `profile_badges` replaced (corrections count; `diff_master` at 25 thanked); `alter publication supabase_realtime add table …` guarded by `if exists (select 1 from pg_publication where pubname = 'supabase_realtime')`.

- [ ] **Step 1: Failing tests** (each named): request creates a pending conversation with the first message, visible to both and to nobody else (third member, moderator, anon → nothing; Review Focus 1); recipient accepts/declines, requester cannot respond; messaging a pending/declined conversation fails; re-request within 30 days of a decline returns success and adds nothing, after 30 days returns to pending; self/blocked/suspended/no-profile targets fail; 11th request in 24 h fails `request limit reached`; 501st message `message limit reached`; 201st correction `correction limit reached` (Review Focus 2); blank or 2 001-char body fails; block hides the conversation from both, unblock shows it again; delete erases body, sets deleted_at, removes its corrections, only by the sender; correction on own or deleted message fails; Thanks only by the sender; report of a message copies it and the 10 before (only when the reporter participates), `report_context` returns them to moderators and nothing to others, and keeps text after the sender deletes it (Review Focus 3); account deletion removes conversations/messages/corrections and nulls snapshot senders; `my_conversations` returns unread counts and shows a declined request as pending to the requester; Diff master at 25 thanked corrections; a correction adds 1 to the author's `practice_days.corrections` on the profile's local day and keeps the streak.
- [ ] **Step 2: Run** `npx vitest run --project supabase --maxWorkers=2` → FAIL. **Step 3: Write 0008.** **Step 4: Run** → PASS; `npm run build:setup-sql`; drift/setup tests pass. **Step 5: Commit** `feat(supabase): private chat, corrections and report context (0008)`.

---

### Task 3: Backend — chat methods and live events (fake + Supabase)

**Files:** Modify `src/main/social/backend.ts`, `fake-backend.ts`, `supabase-backend.ts`, `errors.ts` · Test `tests/main/social-backend.test.ts`, `tests/main/supabase-backend.test.ts`

**Interfaces — Produces:**
```ts
SocialBackend += {
  conversations(): Promise<ConversationSummary[]>;
  messages(conversationId: string, before: number | null): Promise<ChatMessage[]>;   // newest 50 before `before`, oldest first
  requestConversation(userId: string, body: string): Promise<string>;
  respondConversation(conversationId: string, accept: boolean): Promise<void>;
  sendMessage(conversationId: string, body: string): Promise<void>;
  deleteMessage(messageId: number): Promise<void>;
  suggestCorrection(messageId: number, corrected: string): Promise<void>;
  thankCorrection(correctionId: number): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  reportContext(reportId: number): Promise<ReportedMessage[]>;
  /** Live changes for the signed-in member; returns the unsubscribe. */
  subscribe(onEvent: (e: ChatEvent) => void, onStatus: (online: boolean) => void): () => void;
}
FakeSocialBackend += { sendAsForTest(userId: string, conversationId: string, body: string): void }   // the other person writes; emits events
seed 'people' += an accepted conversation Rian–Bia with a few messages and a correction, and a pending request from Ana
```
`mapSupabaseError`: `request limit|message limit|correction limit` → `rate_limited`. Supabase `subscribe` uses one channel with `postgres_changes` on the three tables (RLS-filtered by Realtime), mapping rows to `ChatEvent`; `onStatus` from the channel status.

- [ ] **Step 1: Failing tests:** fake mirrors every Task 2 rule the app relies on (privacy, request/decline silence, limits, delete, corrections, Thanks, block, report context) and emits one event per change only to subscribers who can read it (Review Focus 1, 4); Supabase backend calls the right rpcs/params, maps `my_conversations` and message+correction rows, maps limit errors, subscribe registers the three tables and unsubscribes on sign-out.
- [ ] **Step 2: Run** `npx vitest run --project main --maxWorkers=2` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(main): chat in the social backends`.

---

### Task 4: Main — IPC, live bridge and coach check

**Files:** Modify `src/shared/ipc-contract.ts`, `src/main/ipc/schemas.ts`, `src/main/ipc/social-handlers.ts`, `src/main/ipc/handlers.ts` (coach check), `src/main/ipc/handle.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/main/app-context.ts`, `src/main/index.ts` · Create `src/main/social/chat-live.ts` · Test `tests/main/social-handlers.test.ts`, `tests/main/handlers.test.ts`, `tests/main/chat-live.test.ts`, `tests/main/preload-api.test.ts`

**Interfaces — Produces:** channels `chat:conversations {}`, `chat:messages {conversationId, before}`, `chat:request {userId, body}`, `chat:respond {conversationId, accept}`, `chat:send {conversationId, body}`, `chat:delete {messageId}`, `chat:correct {messageId, corrected}`, `chat:thank {correctionId}`, `chat:read {conversationId}`, `moderation:reportContext {reportId}` (moderators), `chat:check {text}` → `{ rewrite: string; corrections: { original: string; corrected: string; explanation: string }[] }`; event `CHAT_EVENT = 'chat:event'` with `ChatEvent | { kind: 'online' | 'offline' }`; API `chat.*`, `chat.onEvent(cb)`, `moderation.reportContext`. `createChatLive({ backend, emit })` → `{ start(): Promise<void>; stop(): void }` — subscribes when signed in as a member, re-subscribes after sign-in/out, emits `online`/`offline`; never throws.

- [ ] **Step 1: Failing tests:** text through zod (`chatText` rules: blank, 2 001 chars → `validation`); limit copy "You reached the limit of 10 message requests a day. Try again tomorrow." (and messages/corrections); `chat:check` sends only the given text with the free "chat message" context and saves nothing to the local store (store counts unchanged), and an LLM failure returns the usual coach error without side effects (Review Focus 5); chat-live emits events from the fake, stops after sign-out (no event after), emits `offline` then `online` around a simulated drop (Review Focus 4); preload maps every method and `onEvent`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (live bridge started with the window like the practice sync). **Step 4: Run** `npx vitest run --maxWorkers=2` + typecheck → PASS. **Step 5: Commit** `feat(main): IPC, live chat events and the coach check`.

---

### Task 5: Renderer — Messages screen, rail count, requests, Send message

**Files:** Modify `src/renderer/lib/router.ts` (`messages`, `#/messages/<conversation uuid>`), `src/renderer/app/Rail.tsx`, `App.tsx` (palette "Go to Messages"), `src/renderer/screens/MemberProfile.tsx` · Create `src/renderer/screens/MessagesScreen.tsx`, `src/renderer/screens/ConversationView.tsx`, `src/renderer/lib/chat.ts` · CSS in `screens.css` · Test `tests/renderer/router.test.ts`, `tests/renderer/chat.test.ts`

**Interfaces — Produces:** rail item Messages (icon `chat`, new stroke icon) with unread badge from `chat.conversations()` refreshed on `chat:event`; list (avatar/mascot, name, preview or "Message deleted", relative time, unread); conversation view with message groups (yours right/tinted sheet, theirs left), plain-text bodies with newlines, "Load earlier", composer (2 000 counter, Enter sends, Shift+Enter newline), pending states ("Waiting for <name>." / request card with Accept / Decline); `mergeMessages(current, incoming)` (by id, sorted, no duplicates) and `groupByDay` pure helpers; Send message on others' profiles opens the conversation or a request form (first message).

- [ ] **Step 1: Failing tests:** router parses `#/messages` and `#/messages/<uuid>`; `mergeMessages` dedupes and sorts (Review Focus 4); `groupByDay` labels Today / Yesterday / date.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (offline banner on `offline`, refetch on `online`). **Step 4: Run** → PASS (+ typecheck). **Step 5: Commit** `feat(renderer): Messages, requests and Send message`.

---

### Task 6: Renderer — corrections, Thanks, delete, report, coach check

**Files:** Modify `ConversationView.tsx`, `ModerationScreen.tsx` (report context for message reports), CSS · Create `src/renderer/screens/CorrectionEditor.tsx`

**Interfaces — Produces:** message menu (Suggest a correction on theirs, Delete on yours, Report); correction shown under the message as a diff (reuse the galley diff marks) with the author and Thanks (sender only) / "Thanked"; Delete confirms, then "Message deleted"; Report opens `ReportDialog` with `contextType 'message'`; composer "Check with the coach" → diff of your draft with "Use this version" / "Keep mine"; errors from the coach shown inline, Send stays enabled (Review Focus 5); moderation report detail lists the copied context with the reported message marked.

- [ ] **Step 1: Failing e2e** `tests/e2e/chat.spec.ts` (fake `people` seed): open Messages, unread count, open Bia's conversation, send (plain text with `<b>x</b>` shown literally; Review Focus 5), receive a live message from Bia (`sendAsForTest` via a test hook), suggest a correction and see the diff, Thanks from the other side (fake), delete your message → "Message deleted", accept Ana's request, Send message from a profile creates a request, coach check shows a diff and "Use this version" replaces the draft, coach failure still lets you send, block closes the conversation, moderator sees the reported message with context.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the spec → PASS. **Step 5: Commit** `feat(renderer): corrections, Thanks, delete, report and coach check in chat`.

---

### Task 7: Documents — privacy, terms, product

**Files:** `docs/legal/privacy.md`, `docs/legal/terms.md`, `docs/legal/code-of-conduct.md` (version line), `src/core/social/types.ts` (`LEGAL_VERSION`), `tests/core/social.test.ts`, `PRODUCT.md` (chat line), `README.md` (paste 0008)

- [ ] **Step 1: Failing test:** the core test pins the new `LEGAL_VERSION`. **Step 2: Run** → FAIL. **Step 3: Write** (messages on the server, only the two read them, report context, what deletion removes, the coach check sends only your draft). **Step 4: Run** → PASS. **Step 5: Commit** `docs: privacy and terms for private chat`.

---

### Task 8: E2E, screenshots, design review, DESIGN.md

- [ ] **Step 1:** screenshots of Messages (list + conversation with a correction), a request, the composer with a coach diff, both themes × 1440/960; contact sheets; fix in one batch; recheck once; impeccable detector.
- [ ] **Step 2:** impeccable finish reviewer, act on fixes; documenter extends DESIGN.md / design.json (conversation list, bubbles, correction diff, composer).
- [ ] **Step 3:** `npx vitest run --maxWorkers=2 && npm run typecheck && npm run test:e2e` → PASS. **Step 4: Commit** `test: chat end to end; docs(design): messages`.

---

### Task 9: Go live (guided, after the final code review)

- [ ] Copy page for `supabase/migrations/0008_chat.sql`; the user pastes it alone ("Success. No rows returned").
- [ ] The user re-accepts the documents and tests with a second account: request, accept, live messages, a correction and Thanks.
