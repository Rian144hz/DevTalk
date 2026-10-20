-- DevTalk 0009 — voice rooms: rooms opened now by any member, up to 6 live people, room roles, a shared timer and
-- idea card, connection signals between live members, the room list and state, report context for moderators,
-- "Export my data", and the Room host and Active speaker badges. Voice never reaches the database: only who was in
-- which room and when, and the short-lived signals that let two computers connect.
-- Paste this file alone in the SQL Editor on a project that already ran 0001–0008.

-- A room. The host can change; the room ends when nobody is live in it.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  host uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 60),
  theme text not null check (theme in ('standup', 'code_review', 'interview', 'free')),
  level text check (level is null or level in ('A2', 'B1', 'B2', 'C1', 'C2')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  timer_started_at timestamptz,
  timer_seconds int check (timer_seconds in (60, 90)),
  card int not null default 0 check (card >= 0),
  check ((timer_started_at is null) = (timer_seconds is null))
);
create index rooms_created_by on public.rooms (created_by, created_at);
create index rooms_host on public.rooms (host);
create index rooms_open on public.rooms (created_at) where ended_at is null;

-- One row each time someone enters a room. Live while open and heard from in the last 90 seconds.
create table public.room_sessions (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator')),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  removed boolean not null default false,
  mute_requested_at timestamptz,
  check (not removed or left_at is not null)
);
create index room_sessions_room on public.room_sessions (room_id, joined_at);
create index room_sessions_user on public.room_sessions (user_id, room_id);
-- One open session per person: one room at a time.
create unique index room_sessions_one_open on public.room_sessions (user_id) where left_at is null;

-- Connection signals (offers, answers, network candidates, bye). They hold network addresses: only the recipient
-- reads them, and a heartbeat deletes them after 5 minutes.
create table public.room_signals (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'candidate', 'bye')),
  payload text not null check (octet_length(payload) <= 16384),
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index room_signals_room on public.room_signals (room_id, created_at);
create index room_signals_sender on public.room_signals (sender, created_at);
create index room_signals_recipient on public.room_signals (recipient);
create index room_signals_created on public.room_signals (created_at);

-- Internal helpers. They take any ids or change any room, so nobody calls them through the API.

-- A session is live while it is open and its last heartbeat is less than 90 seconds old.
create or replace function public.room_session_live(left_at timestamptz, last_seen timestamptz) returns boolean
language sql stable set search_path = public as $$
  select left_at is null and last_seen > now() - interval '90 seconds'
$$;

create or replace function public.room_is_live(room uuid, member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_sessions s
    where s.room_id = room and s.user_id = member and public.room_session_live(s.left_at, s.last_seen)
  )
$$;

-- After someone leaves or goes silent: silent sessions close at their last heartbeat; a host who is gone hands the
-- room to the oldest live room moderator, else to the earliest live member; a room with nobody live ends.
create or replace function public.room_settle(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  current_host uuid;
  heir uuid;
begin
  select r.host into current_host from public.rooms r where r.id = room and r.ended_at is null for update;
  if not found then
    return;
  end if;
  update public.room_sessions s set left_at = s.last_seen
    where s.room_id = room and s.left_at is null and not public.room_session_live(s.left_at, s.last_seen);
  if public.room_is_live(room, current_host) then
    return;
  end if;
  select s.user_id into heir from public.room_sessions s
    where s.room_id = room and public.room_session_live(s.left_at, s.last_seen)
    order by s.role = 'moderator' desc, s.joined_at, s.id
    limit 1;
  if heir is null then
    update public.rooms r set ended_at = now(), timer_started_at = null, timer_seconds = null where r.id = room;
  else
    update public.rooms r set host = heir where r.id = room;
  end if;
end
$$;

-- Closes `member`'s open session in `room` (now while live, else at the last heartbeat), then settles the room.
create or replace function public.room_close_session(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.rooms r where r.id = room for update;
  update public.room_sessions s
    set left_at = case when public.room_session_live(s.left_at, s.last_seen) then now() else s.last_seen end
    where s.room_id = room and s.user_id = member and s.left_at is null;
  perform public.room_settle(room);
end
$$;

-- Closes `member`'s open sessions in every room but `keep`.
create or replace function public.room_close_others(member uuid, keep uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  other uuid;
begin
  for other in
    select s.room_id from public.room_sessions s
    where s.user_id = member and s.left_at is null and s.room_id is distinct from keep
  loop
    perform public.room_close_session(other, member);
  end loop;
end
$$;

revoke execute on function public.room_session_live(timestamptz, timestamptz), public.room_is_live(uuid, uuid),
  public.room_settle(uuid), public.room_close_session(uuid, uuid), public.room_close_others(uuid, uuid)
  from public, anon, authenticated;

-- Caller-only helpers for the policies: each answers about the signed-in person.

-- The caller is a member live in `room`.
create or replace function public.viewer_in_room(room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.viewer_is_member() and public.room_is_live(room, auth.uid())
$$;

-- The caller is a member who has, or had, a session in `room`.
create or replace function public.viewer_was_in_room(room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.viewer_is_member()
    and exists (select 1 from public.room_sessions s where s.room_id = room and s.user_id = auth.uid())
$$;

-- The caller may send a signal to `recipient` in `room`: both live there, and no block between them.
create or replace function public.can_signal(room uuid, recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select recipient <> auth.uid()
    and public.viewer_in_room(room)
    and public.room_is_live(room, recipient)
    and not public.is_blocked_between(auth.uid(), recipient)
$$;

revoke execute on function public.viewer_in_room(uuid), public.viewer_was_in_room(uuid), public.can_signal(uuid, uuid)
  from public, anon;
grant execute on function public.viewer_in_room(uuid), public.viewer_was_in_room(uuid), public.can_signal(uuid, uuid)
  to authenticated;

-- At most 600 signals per person in any minute.
create or replace function public.limit_room_signals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.room_signals g
      where g.sender = new.sender and g.created_at > now() - interval '1 minute') >= 600 then
    raise exception 'signal limit reached' using hint = 'Wait a minute and try again.';
  end if;
  return new;
end
$$;
create trigger room_signals_limit before insert on public.room_signals
  for each row execute function public.limit_room_signals();

-- Blocking someone who is live in your room takes you out of it. The blocked person stays.
create or replace function public.leave_rooms_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  shared uuid;
begin
  for shared in
    select s.room_id from public.room_sessions s
    where s.user_id = new.blocker and s.left_at is null and public.room_is_live(s.room_id, new.blocked)
  loop
    perform public.room_close_session(shared, new.blocker);
  end loop;
  return null;
end
$$;
create trigger blocks_leave_rooms after insert on public.blocks
  for each row execute function public.leave_rooms_on_block();

revoke execute on function public.limit_room_signals(), public.leave_rooms_on_block() from public, anon, authenticated;

-- Open a room and enter it as the host. Leaves the room you were in, if any.
create or replace function public.create_room(title text, theme text, level text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  -- Trimmed like JavaScript's String.prototype.trim.
  clean text := regexp_replace(coalesce(create_room.title, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g');
  room uuid;
begin
  if me is null or not public.viewer_is_member() or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not allowed' using errcode = '42501', hint = 'You cannot open a room.';
  end if;
  if char_length(clean) not between 3 and 60 then
    raise exception 'room title is not valid' using errcode = '22023', hint = 'Write 3 to 60 characters.';
  end if;
  if create_room.theme is null or create_room.theme not in ('standup', 'code_review', 'interview', 'free') then
    raise exception 'room theme is not valid' using errcode = '22023';
  end if;
  if create_room.level is not null and create_room.level not in ('A2', 'B1', 'B2', 'C1', 'C2') then
    raise exception 'room level is not valid' using errcode = '22023';
  end if;
  if (select count(*) from public.rooms r where r.created_by = me and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'room limit reached' using hint = 'Try again tomorrow.';
  end if;
  perform public.room_close_others(me, null);
  insert into public.rooms (created_by, host, title, theme, level)
    values (me, me, clean, create_room.theme, create_room.level)
    returning id into room;
  insert into public.room_sessions (room_id, user_id) values (room, me);
  return room;
end
$$;

-- Enter a room: a member with a profile, a room with someone live in it and a free seat, never removed from it,
-- and no block with anyone live inside. Leaves the room you were in. Joining the room you are live in does nothing.
create or replace function public.join_room(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  seats int;
begin
  if me is null or not public.viewer_is_member() or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not allowed' using errcode = '42501', hint = 'You cannot join this room.';
  end if;
  -- Lock this room and the one you are leaving, always in the same order, so joins wait for each other and the
  -- seats are counted one join at a time.
  perform 1 from public.rooms r
    where r.id = room
      or r.id in (select s.room_id from public.room_sessions s where s.user_id = me and s.left_at is null)
    order by r.id
    for update;
  if not exists (select 1 from public.rooms r where r.id = room and r.ended_at is null) then
    raise exception 'not allowed' using errcode = '42501', hint = 'This room has ended.';
  end if;
  if public.room_is_live(room, me) then
    return;
  end if;
  if exists (select 1 from public.room_sessions s where s.room_id = room and s.user_id = me and s.removed) then
    raise exception 'not allowed' using errcode = '42501', hint = 'You were removed from this room.';
  end if;
  select count(*) into seats from public.room_sessions s
    where s.room_id = room and public.room_session_live(s.left_at, s.last_seen);
  if seats = 0 then
    raise exception 'not allowed' using errcode = '42501', hint = 'This room has ended.';
  end if;
  if exists (
    select 1 from public.room_sessions s
    where s.room_id = room and public.room_session_live(s.left_at, s.last_seen) and public.is_blocked_between(me, s.user_id)
  ) then
    raise exception 'not allowed' using errcode = '42501', hint = 'You cannot join this room.';
  end if;
  if seats >= 6 then
    raise exception 'room is full' using hint = 'Try another room.';
  end if;
  perform public.room_close_others(me, room);
  -- A silent session of yours in this room closes at its last heartbeat before the new one opens.
  update public.room_sessions s set left_at = s.last_seen where s.room_id = room and s.user_id = me and s.left_at is null;
  insert into public.room_sessions (room_id, user_id) values (room, me);
  perform public.room_settle(room);
end
$$;

-- Leave a room. Leaving a room you are not in does nothing.
create or replace function public.leave_room(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.room_close_session(room, auth.uid());
end
$$;

-- "I am still here", every 30 seconds. False when you are no longer live in the room (silent too long, removed,
-- left, the room ended, or you are no longer a member). Also settles the room and deletes every signal older than
-- 5 minutes, in any room (also rooms nobody sends heartbeats to any more), skipping rows another heartbeat is deleting.
create or replace function public.room_heartbeat(room uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  still boolean;
begin
  if me is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sessions s where s.room_id = room and s.user_id = me) then
    return false;
  end if;
  perform 1 from public.rooms r where r.id = room for update;
  update public.room_sessions s set last_seen = now()
    where s.room_id = room and s.user_id = me and public.room_session_live(s.left_at, s.last_seen)
      and public.viewer_is_member();
  still := found;
  if not still then
    perform public.room_close_session(room, me);
  end if;
  perform public.room_settle(room);
  delete from public.room_signals g where g.id in (
    select o.id from public.room_signals o where o.created_at < now() - interval '5 minutes' for update skip locked
  );
  return still;
end
$$;

-- Room roles. Only the host, live in the room, gives or takes Room moderator, and passes the host role, to someone
-- else live in it.
create or replace function public.make_room_moderator(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.rooms r where r.id = room and r.ended_at is null and r.host = auth.uid() for update;
  if not found or not public.viewer_in_room(room) or member is null or member = auth.uid()
    or not public.room_is_live(room, member) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_sessions s set role = 'moderator'
    where s.room_id = room and s.user_id = member and s.left_at is null;
end
$$;

create or replace function public.remove_room_moderator(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.rooms r where r.id = room and r.ended_at is null and r.host = auth.uid() for update;
  if not found or not public.viewer_in_room(room) or member is null or member = auth.uid()
    or not public.room_is_live(room, member) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_sessions s set role = 'member'
    where s.room_id = room and s.user_id = member and s.left_at is null;
end
$$;

create or replace function public.pass_host(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.rooms r where r.id = room and r.ended_at is null and r.host = auth.uid() for update;
  if not found or not public.viewer_in_room(room) or member is null or member = auth.uid()
    or not public.room_is_live(room, member) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.rooms r set host = member where r.id = room;
end
$$;

-- Ask someone live to mute: the host or a live room moderator, never against the host. They can unmute any time.
create or replace function public.mute_member(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  host_id uuid;
  my_role text;
begin
  select r.host into host_id from public.rooms r where r.id = room and r.ended_at is null for update;
  select s.role into my_role from public.room_sessions s
    where s.room_id = room and s.user_id = me and public.room_session_live(s.left_at, s.last_seen);
  if host_id is null or not public.viewer_is_member() or my_role is null or member is null or member = me
    or member = host_id or not (me = host_id or my_role = 'moderator') or not public.room_is_live(room, member) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_sessions s set mute_requested_at = now()
    where s.room_id = room and s.user_id = member and s.left_at is null;
end
$$;

-- Remove someone from the room for good: the host, or a live room moderator against a member. Never the host.
create or replace function public.remove_from_room(room uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  host_id uuid;
  my_role text;
  their_role text;
begin
  select r.host into host_id from public.rooms r where r.id = room and r.ended_at is null for update;
  select s.role into my_role from public.room_sessions s
    where s.room_id = room and s.user_id = me and public.room_session_live(s.left_at, s.last_seen);
  select s.role into their_role from public.room_sessions s
    where s.room_id = room and s.user_id = member and s.left_at is null;
  if host_id is null or not public.viewer_is_member() or my_role is null or their_role is null or member = me
    or member = host_id or not (me = host_id or (my_role = 'moderator' and their_role = 'member')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_sessions s
    set removed = true,
      left_at = case when public.room_session_live(s.left_at, s.last_seen) then now() else s.last_seen end
    where s.room_id = room and s.user_id = member and s.left_at is null;
end
$$;

-- End the room for everyone: only the host, live in it.
create or replace function public.end_room(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform 1 from public.rooms r where r.id = room and r.ended_at is null and r.host = auth.uid() for update;
  if not found or not public.viewer_in_room(room) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_sessions s
    set left_at = case when public.room_session_live(s.left_at, s.last_seen) then now() else s.last_seen end
    where s.room_id = room and s.left_at is null;
  update public.rooms r set ended_at = now(), timer_started_at = null, timer_seconds = null where r.id = room;
end
$$;

-- The shared speaking timer (60 or 90 seconds) and idea card: anyone live in the room.
create or replace function public.start_timer(room uuid, seconds int) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.viewer_in_room(room) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if seconds is null or seconds not in (60, 90) then
    raise exception 'timer is not valid' using errcode = '22023', hint = 'Use 60 or 90 seconds.';
  end if;
  update public.rooms r set timer_started_at = now(), timer_seconds = seconds where r.id = room and r.ended_at is null;
end
$$;

create or replace function public.stop_timer(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.viewer_in_room(room) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.rooms r set timer_started_at = null, timer_seconds = null where r.id = room and r.ended_at is null;
end
$$;

create or replace function public.next_card(room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.viewer_in_room(room) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.rooms r set card = r.card + 1 where r.id = room and r.ended_at is null;
end
$$;

-- The room list: rooms not ended with someone live, and nobody live inside blocked with the caller (either way).
-- People are the live ones, in the order they joined.
create or replace function public.live_rooms()
returns table (id uuid, title text, theme text, level text, host_name text, people jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.theme, r.level, h.display_name,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'hasAvatar', p.avatar_path is not null,
        'mascot', p.mascot) order by s.joined_at, s.id)
      from public.room_sessions s join public.profiles p on p.id = s.user_id
      where s.room_id = r.id and public.room_session_live(s.left_at, s.last_seen)
    ), '[]'::jsonb),
    r.created_at
  from public.rooms r
  left join public.profiles h on h.id = r.host
  where public.viewer_is_member()
    and r.ended_at is null
    and exists (
      select 1 from public.room_sessions s where s.room_id = r.id and public.room_session_live(s.left_at, s.last_seen)
    )
    and not exists (
      select 1 from public.room_sessions s
      where s.room_id = r.id and public.room_session_live(s.left_at, s.last_seen)
        and public.is_blocked_between(auth.uid(), s.user_id)
    )
  order by r.created_at desc, r.id
$$;

-- What the window draws for a room the caller has been in; null for any other room. People only while the caller
-- is live there. `me` describes the caller's latest session.
create or replace function public.room_state(room uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.rooms%rowtype;
  mine public.room_sessions%rowtype;
  is_live boolean;
begin
  if me is null then
    return null;
  end if;
  select * into mine from public.room_sessions s where s.room_id = room and s.user_id = me order by s.id desc limit 1;
  if not found then
    return null;
  end if;
  select * into r from public.rooms x where x.id = room;
  is_live := public.viewer_is_member() and r.ended_at is null and public.room_session_live(mine.left_at, mine.last_seen);
  return json_build_object(
    'id', r.id, 'title', r.title, 'theme', r.theme, 'level', r.level, 'hostId', r.host, 'endedAt', r.ended_at,
    'timer', case when r.timer_started_at is null then null
      else json_build_object('startedAt', r.timer_started_at, 'seconds', r.timer_seconds) end,
    'card', r.card,
    'me', json_build_object(
      'live', is_live,
      'removed', exists (select 1 from public.room_sessions s where s.room_id = room and s.user_id = me and s.removed),
      'role', case when r.host = me then 'host' else mine.role end,
      'muteRequestedAt', mine.mute_requested_at),
    'people', case when is_live then coalesce((
      select json_agg(json_build_object('id', p.id, 'displayName', p.display_name, 'hasAvatar', p.avatar_path is not null,
        'mascot', p.mascot, 'level', p.level, 'role', case when s.user_id = r.host then 'host' else s.role end)
        order by s.joined_at, s.id)
      from public.room_sessions s join public.profiles p on p.id = s.user_id
      where s.room_id = room and public.room_session_live(s.left_at, s.last_seen)
    ), '[]'::json) else '[]'::json end
  );
end
$$;

-- A reported room as moderators see it: title, theme, host and who was there when. Only for an active moderator,
-- a room report whose id is that room, and a room the reported person (and the reporter, while their account
-- exists) was in; null otherwise.
create or replace function public.room_report_context(report bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  x public.reports%rowtype;
  target uuid;
begin
  if not (public.is_moderator() and public.viewer_is_active()) then
    return null;
  end if;
  select * into x from public.reports k where k.id = report;
  if not found or x.context_type <> 'room' or x.context_id is null
    or x.context_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  target := x.context_id::uuid;
  if x.reported is null
    or not exists (select 1 from public.room_sessions s where s.room_id = target and s.user_id = x.reported)
    or (x.reporter is not null
      and not exists (select 1 from public.room_sessions s where s.room_id = target and s.user_id = x.reporter)) then
    return null;
  end if;
  return (
    select json_build_object('title', r.title, 'theme', r.theme, 'hostName', h.display_name, 'createdAt', r.created_at,
      'people', coalesce((
        select json_agg(json_build_object('name', p.display_name, 'joinedAt', s.joined_at,
          'leftAt', coalesce(s.left_at, case when not public.room_session_live(s.left_at, s.last_seen) then s.last_seen end))
          order by s.joined_at, s.id)
        from public.room_sessions s left join public.profiles p on p.id = s.user_id
        where s.room_id = r.id
      ), '[]'::json))
    from public.rooms r left join public.profiles h on h.id = r.host
    where r.id = target
  );
end
$$;

-- "Export my data": the rooms you opened and your own sessions. Other people's sessions are their data and stay out.
create or replace function public.my_rooms_export() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'roomsCreated', coalesce((
      select json_agg(json_build_object('id', r.id, 'title', r.title, 'theme', r.theme, 'createdAt', r.created_at,
        'endedAt', r.ended_at) order by r.created_at, r.id)
      from public.rooms r where r.created_by = auth.uid()
    ), '[]'::json),
    'sessions', coalesce((
      select json_agg(json_build_object('roomId', s.room_id, 'joinedAt', s.joined_at, 'leftAt', s.left_at, 'role', s.role,
        'removed', s.removed) order by s.id)
      from public.room_sessions s where s.user_id = auth.uid()
    ), '[]'::json)
  )
$$;

revoke execute on function public.create_room(text, text, text), public.join_room(uuid), public.leave_room(uuid),
  public.room_heartbeat(uuid), public.make_room_moderator(uuid, uuid), public.remove_room_moderator(uuid, uuid),
  public.pass_host(uuid, uuid), public.mute_member(uuid, uuid), public.remove_from_room(uuid, uuid),
  public.end_room(uuid), public.start_timer(uuid, int), public.stop_timer(uuid), public.next_card(uuid),
  public.live_rooms(), public.room_state(uuid), public.room_report_context(bigint), public.my_rooms_export()
  from public, anon;
grant execute on function public.create_room(text, text, text), public.join_room(uuid), public.leave_room(uuid),
  public.room_heartbeat(uuid), public.make_room_moderator(uuid, uuid), public.remove_room_moderator(uuid, uuid),
  public.pass_host(uuid, uuid), public.mute_member(uuid, uuid), public.remove_from_room(uuid, uuid),
  public.end_room(uuid), public.start_timer(uuid, int), public.stop_timer(uuid), public.next_card(uuid),
  public.live_rooms(), public.room_state(uuid), public.room_report_context(bigint), public.my_rooms_export()
  to authenticated;

-- Badges, now with Room host (5 rooms opened where someone else had a session) and Active speaker (10 sessions of
-- 5+ minutes that overlapped someone else's session by 5+ minutes) after Diff master.
create or replace function public.profile_badges(target uuid)
returns table (id text, grp text, label text, detail text)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p public.profiles%rowtype;
  streak_now int;
  last_level text;
  vocabulary_tier text;
begin
  if me is null or not (target = me or public.is_moderator() or public.can_see_profile(target)) then
    return;
  end if;
  select * into p from public.profiles where profiles.id = target;
  if not found then
    return;
  end if;

  if exists (select 1 from public.badge_grants g where g.user_id = target and g.badge = 'creator') then
    return query select 'creator'::text, 'community'::text, 'Creator'::text, null::text;
  end if;
  if exists (select 1 from public.moderators m where m.user_id = target) then
    return query select 'moderator'::text, 'community'::text, 'Moderator'::text, null::text;
  end if;
  if p.created_at < timestamptz '2027-01-01 00:00:00 America/Sao_Paulo' then
    return query select 'founding_member'::text, 'community'::text, 'Founding member'::text, null::text;
  end if;
  return query
    select g.badge, 'community'::text, public.badge_label(g.badge), null::text
    from public.badge_grants g
    where g.user_id = target and g.badge <> 'creator'
    order by array_position(array['beta_tester', 'mentor', 'open_source'], g.badge);
  if (select count(*) from public.corrections k where k.author = target and k.thanked_at is not null) >= 25 then
    return query select 'diff_master'::text, 'community'::text, 'Diff master'::text, null::text;
  end if;
  if (select count(*) from public.rooms r
      where r.created_by = target
        and exists (select 1 from public.room_sessions s where s.room_id = r.id and s.user_id <> target)) >= 5 then
    return query select 'room_host'::text, 'community'::text, 'Room host'::text, null::text;
  end if;
  if (select count(*) from public.room_sessions s
      where s.user_id = target
        and coalesce(s.left_at, s.last_seen) - s.joined_at >= interval '5 minutes'
        and exists (
          select 1 from public.room_sessions o
          where o.room_id = s.room_id and o.user_id <> target
            and least(coalesce(s.left_at, s.last_seen), coalesce(o.left_at, o.last_seen))
              - greatest(s.joined_at, o.joined_at) >= interval '5 minutes'
        )) >= 10 then
    return query select 'active_speaker'::text, 'community'::text, 'Active speaker'::text, null::text;
  end if;

  if p.area <> 'other' then
    return query select 'area:' || p.area, 'technical'::text,
      case p.area when 'backend' then 'Back end' when 'frontend' then 'Front end' when 'mobile' then 'Mobile'
        when 'data' then 'Data' else 'DevOps' end, null::text;
  end if;
  if p.uses_linux then
    return query select 'linux'::text, 'technical'::text, 'Linux native'::text, null::text;
  end if;
  return query select 'lang:' || u.t, 'language'::text, u.t, null::text
    from unnest(p.main_stack) with ordinality as u(t, o) order by u.o;

  if target = me or p.show_progress then
    select s.current into streak_now from public.practice_streak_values(target) s;
    if streak_now >= 30 then
      return query select 'streak_30'::text, 'evolution'::text, '30-day streak'::text, streak_now::text;
    elsif streak_now >= 7 then
      return query select 'streak_7'::text, 'evolution'::text, '7-day streak'::text, streak_now::text;
    end if;
    select m.value into last_level from public.milestones m
      where m.user_id = target and m.kind = 'level_up' order by m.achieved_at desc limit 1;
    if last_level is not null then
      return query select 'level_up'::text, 'evolution'::text, replace(last_level, '>', ' → '), last_level;
    end if;
    select max(m.value::int)::text into vocabulary_tier from public.milestones m
      where m.user_id = target and m.kind = 'vocabulary';
    if vocabulary_tier is not null then
      return query select 'vocabulary'::text, 'evolution'::text, 'Vocabulary hunter'::text, vocabulary_tier || '+';
    end if;
  end if;
end
$$;
revoke execute on function public.profile_badges(uuid) from public, anon;
grant execute on function public.profile_badges(uuid) to authenticated;

-- Grants and policies. Rooms and sessions change only through the functions above; signals are inserted directly.
alter table public.rooms enable row level security;
alter table public.room_sessions enable row level security;
alter table public.room_signals enable row level security;

revoke all on public.rooms, public.room_sessions, public.room_signals from anon, authenticated;
grant select on public.rooms, public.room_sessions, public.room_signals to authenticated;
grant insert (room_id, sender, recipient, kind, payload) on public.room_signals to authenticated;

-- Anyone who has been in the room reads it, so the end, the timer and the card reach people just taken out of it.
create policy rooms_select on public.rooms for select to authenticated
  using (public.viewer_was_in_room(id));

-- Your own sessions, and every session of the room you are live in (so a removal or a mute reaches the person).
create policy room_sessions_select on public.room_sessions for select to authenticated
  using ((select public.viewer_is_member()) and (user_id = (select auth.uid()) or public.viewer_in_room(room_id)));

create policy room_signals_select on public.room_signals for select to authenticated
  using (recipient = (select auth.uid()) and (select public.viewer_is_member()));
create policy room_signals_insert on public.room_signals for insert to authenticated
  with check (sender = (select auth.uid()) and public.can_signal(room_id, recipient));

-- Live updates for the app (Supabase Realtime applies the policies above to every event).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms, public.room_sessions, public.room_signals;
  end if;
end
$$;
