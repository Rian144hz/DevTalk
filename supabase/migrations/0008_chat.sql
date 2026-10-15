-- DevTalk 0008 — private chat: conversations by accepted request, messages, peer corrections with Thanks,
-- unread counts, report context for moderators, corrections in the practice graph and the Diff master badge.
-- Paste this file alone in the SQL Editor on a project that already ran 0001–0007.

-- A conversation between two people, stored once per pair (a < b).
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  last_message_at timestamptz not null default now(),
  unique (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index conversations_b on public.conversations (b);
create index conversations_requests on public.conversations (requested_by, created_at);

-- A deleted message keeps its place with empty text.
create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint messages_body_check check (
    (deleted_at is null and char_length(body) between 1 and 2000 and body ~ '[^[:space:]]')
    or (deleted_at is not null and body = '')
  )
);
create index messages_conversation on public.messages (conversation_id, id);
create index messages_sender on public.messages (sender, created_at);

-- One correction per message and author; the author is never the sender (checked on insert).
create table public.corrections (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  author uuid not null default auth.uid() references auth.users (id) on delete cascade,
  corrected text not null check (char_length(corrected) between 1 and 2000 and corrected ~ '[^[:space:]]'),
  created_at timestamptz not null default now(),
  thanked_at timestamptz,
  unique (message_id, author)
);
create index corrections_author on public.corrections (author, created_at);

-- The last message each person has read in a conversation, for unread counts.
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_id bigint not null default 0,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- A copy of a reported message and the 10 before it, made when the report is sent. Moderators read it
-- through report_context; it stays when a message is deleted, and loses only the sender when an account is.
create table public.report_messages (
  report_id bigint not null references public.reports (id) on delete cascade,
  message_id bigint not null,
  sender uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null,
  primary key (report_id, message_id)
);

-- Corrections given count in the practice graph.
alter table public.practice_days
  add column corrections int not null default 0 check (corrections between 0 and 2000);

-- Helpers: whether the caller may read or write in a conversation. Caller-only.
create or replace function public.can_read_conversation(conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.viewer_is_member() and exists (
    select 1 from public.conversations c
    where c.id = conversation and auth.uid() in (c.a, c.b) and not public.is_blocked_between(c.a, c.b)
  )
$$;

create or replace function public.can_write_conversation(conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_read_conversation(conversation)
    and exists (select 1 from public.conversations c where c.id = conversation and c.status = 'accepted')
$$;

-- The caller may correct a message: not their own, not deleted, in an open conversation they are in.
create or replace function public.can_correct_message(message bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.id = message and m.sender <> auth.uid() and m.deleted_at is null
      and public.can_write_conversation(m.conversation_id)
  )
$$;

create or replace function public.can_read_message(message bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m where m.id = message and public.can_read_conversation(m.conversation_id)
  )
$$;

revoke execute on function public.can_read_conversation(uuid), public.can_write_conversation(uuid),
  public.can_correct_message(bigint), public.can_read_message(bigint) from public, anon;
grant execute on function public.can_read_conversation(uuid), public.can_write_conversation(uuid),
  public.can_correct_message(bigint), public.can_read_message(bigint) to authenticated;

-- Limits and bookkeeping.
create or replace function public.limit_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.messages m
      where m.sender = new.sender and m.created_at > now() - interval '24 hours') >= 500 then
    raise exception 'message limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;
create trigger messages_limit before insert on public.messages
  for each row execute function public.limit_messages();

create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end
$$;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

create or replace function public.limit_corrections() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.corrections k
      where k.author = new.author and k.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'correction limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;
create trigger corrections_limit before insert on public.corrections
  for each row execute function public.limit_corrections();

-- A correction adds 1 to the author's practice day, in the time zone of their profile.
create or replace function public.count_correction() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  local_day date := (now() at time zone public.safe_time_zone(
    coalesce((select p.timezone from public.profiles p where p.id = new.author), 'UTC')))::date;
begin
  insert into public.practice_days (user_id, day, corrections) values (new.author, local_day, 1)
  on conflict (user_id, day) do update set corrections = least(public.practice_days.corrections + 1, 2000);
  return null;
end
$$;
create trigger corrections_practice after insert on public.corrections
  for each row execute function public.count_correction();

-- A message report from someone in the conversation copies the message and the 10 before it.
create or replace function public.snapshot_reported_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target public.messages%rowtype;
begin
  if new.context_type <> 'message' or new.context_id is null or new.context_id !~ '^[0-9]{1,18}$' then
    return null;
  end if;
  select * into target from public.messages m where m.id = new.context_id::bigint;
  if not found or not exists (
    select 1 from public.conversations c where c.id = target.conversation_id and new.reporter in (c.a, c.b)
  ) then
    return null;
  end if;
  insert into public.report_messages (report_id, message_id, sender, body, created_at)
  select new.id, m.id, m.sender, m.body, m.created_at from public.messages m
  where m.conversation_id = target.conversation_id and m.id <= target.id
  order by m.id desc limit 11;
  return null;
end
$$;
create trigger reports_snapshot_message after insert on public.reports
  for each row execute function public.snapshot_reported_message();

revoke execute on function public.limit_messages(), public.touch_conversation(), public.limit_corrections(),
  public.count_correction(), public.snapshot_reported_message() from public, anon, authenticated;

-- Ask someone for a conversation with a first message. Asking again within 30 days of a decline looks the
-- same as success and changes nothing; asking someone who already asked you accepts their request.
create or replace function public.request_conversation(target uuid, body text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c public.conversations%rowtype;
  existed boolean;
begin
  if me is null or not public.viewer_is_member()
    or not exists (select 1 from public.profiles p where p.id = me)
    or target is null or target = me
    or not public.can_see_profile(target)
    or not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'not allowed' using errcode = '42501', hint = 'You cannot message this person.';
  end if;
  if body is null or char_length(body) not between 1 and 2000 or body !~ '[^[:space:]]' then
    raise exception 'message text is not valid' using errcode = '22023', hint = 'Write 1 to 2000 characters.';
  end if;

  select * into c from public.conversations x where x.a = least(me, target) and x.b = greatest(me, target) for update;
  existed := found;
  if existed then
    if c.status = 'accepted' or (c.status = 'pending' and c.requested_by = me)
      or (c.status = 'declined' and c.requested_by = me and c.responded_at > now() - interval '30 days') then
      return c.id;
    end if;
    if c.status = 'pending' then
      update public.conversations set status = 'accepted', responded_at = now() where id = c.id;
      insert into public.messages (conversation_id, sender, body) values (c.id, me, body);
      return c.id;
    end if;
  end if;

  if (select count(*) from public.conversations x
      where x.requested_by = me and x.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'request limit reached' using hint = 'Try again tomorrow.';
  end if;
  if existed then
    update public.conversations
      set status = 'pending', requested_by = me, created_at = now(), responded_at = null
      where id = c.id;
  else
    insert into public.conversations (a, b, requested_by) values (least(me, target), greatest(me, target), me)
      returning * into c;
  end if;
  insert into public.messages (conversation_id, sender, body) values (c.id, me, body);
  return c.id;
end
$$;

-- Accept or decline a request you received.
create or replace function public.respond_conversation(conversation uuid, accept boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.conversations c
    set status = case when accept then 'accepted' else 'declined' end, responded_at = now()
    where c.id = conversation and c.status = 'pending' and accept is not null
      and auth.uid() in (c.a, c.b) and c.requested_by <> auth.uid()
      and public.can_read_conversation(c.id);
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end
$$;

-- Delete your own message: the text goes, and so do its corrections.
create or replace function public.delete_message(message bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.messages m where m.id = message and m.sender = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.corrections k where k.message_id = message;
  update public.messages m set body = '', deleted_at = now() where m.id = message and m.deleted_at is null;
end
$$;

-- Thank a correction of your own message.
create or replace function public.thank_correction(correction bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.corrections k set thanked_at = coalesce(k.thanked_at, now())
    where k.id = correction
      and exists (
        select 1 from public.messages m
        where m.id = k.message_id and m.sender = auth.uid() and public.can_read_conversation(m.conversation_id)
      );
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end
$$;

-- Mark a conversation read up to its newest message. Does nothing outside your conversations.
create or replace function public.mark_read(conversation uuid) returns void
language sql volatile security definer set search_path = public as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_id, last_read_at)
  select conversation, auth.uid(), coalesce((select max(m.id) from public.messages m where m.conversation_id = conversation), 0), now()
  where public.can_read_conversation(conversation)
  on conflict (conversation_id, user_id) do update
    set last_read_id = greatest(public.conversation_reads.last_read_id, excluded.last_read_id), last_read_at = now()
$$;

-- The caller's conversations and requests, newest first. A request you declined disappears for you; for the
-- person who asked it stays "pending".
create or replace function public.my_conversations()
returns table (id uuid, other_id uuid, other_name text, other_has_avatar boolean, other_mascot text, status text,
  requested_by_me boolean, preview text, last_message_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, p.id, p.display_name, p.avatar_path is not null, p.mascot,
    case when c.status = 'declined' then 'pending' else c.status end,
    c.requested_by = auth.uid(),
    (select case when m.deleted_at is null then left(m.body, 140) else 'Message deleted' end
      from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
    c.last_message_at,
    (select count(*)::int from public.messages m
      where m.conversation_id = c.id and m.sender <> auth.uid() and m.deleted_at is null
        and m.id > coalesce((select r.last_read_id from public.conversation_reads r
          where r.conversation_id = c.id and r.user_id = auth.uid()), 0))
  from public.conversations c
  join public.profiles p on p.id = case when c.a = auth.uid() then c.b else c.a end
  where public.viewer_is_member() and auth.uid() in (c.a, c.b)
    and not public.is_blocked_between(c.a, c.b)
    and (c.status <> 'declined' or c.requested_by = auth.uid())
  order by c.last_message_at desc, c.id
$$;

-- The copied messages of a report, for moderators only; nothing for anyone else.
create or replace function public.report_context(report bigint)
returns table (message_id bigint, sender_name text, body text, created_at timestamptz, reported boolean)
language sql stable security definer set search_path = public as $$
  select s.message_id, p.display_name, s.body, s.created_at, s.message_id::text = r.context_id
  from public.report_messages s
  join public.reports r on r.id = s.report_id
  left join public.profiles p on p.id = s.sender
  where s.report_id = report and public.is_moderator() and public.viewer_is_active()
  order by s.message_id
$$;

revoke execute on function public.request_conversation(uuid, text), public.respond_conversation(uuid, boolean),
  public.delete_message(bigint), public.thank_correction(bigint), public.mark_read(uuid), public.my_conversations(),
  public.report_context(bigint) from public, anon;
grant execute on function public.request_conversation(uuid, text), public.respond_conversation(uuid, boolean),
  public.delete_message(bigint), public.thank_correction(bigint), public.mark_read(uuid), public.my_conversations(),
  public.report_context(bigint) to authenticated;

-- Streaks count days with answers, reviews or corrections.
create or replace function public.practice_streak_values(target uuid)
returns table (current int, longest int)
language sql stable security definer set search_path = public as $$
  with today as (
    select (now() at time zone public.safe_time_zone(coalesce((select p.timezone from public.profiles p where p.id = target), 'UTC')))::date as d
  ),
  active as (
    select d.day from public.practice_days d where d.user_id = target and d.answers + d.reviews + d.corrections > 0
  ),
  grouped as (
    select day, day - (row_number() over (order by day))::int as grp from active
  ),
  runs as (
    select max(day) as last_day, count(*)::int as n from grouped group by grp
  )
  select
    coalesce((select r.n from runs r, today where r.last_day >= today.d - 1 order by r.last_day desc limit 1), 0)::int,
    coalesce((select max(r.n) from runs r), 0)::int
$$;
revoke execute on function public.practice_streak_values(uuid) from public, anon, authenticated;

-- Badges, now with Diff master (25 corrections that received Thanks) after the manual community badges.
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

-- Grants and policies. Conversations change only through the functions above.
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.corrections enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.report_messages enable row level security;

revoke all on public.conversations, public.messages, public.corrections, public.conversation_reads,
  public.report_messages from anon, authenticated;
grant select on public.conversations, public.messages, public.corrections to authenticated;
grant insert (conversation_id, sender, body) on public.messages to authenticated;
grant insert (message_id, author, corrected) on public.corrections to authenticated;
grant select (corrections) on public.practice_days to authenticated;

-- A request you sent and that was declined is hidden from you, so no event or row tells you.
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_read_conversation(id) and (status <> 'declined' or requested_by <> (select auth.uid())));

create policy messages_select on public.messages for select to authenticated
  using (public.can_read_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender = (select auth.uid()) and public.can_write_conversation(conversation_id));

create policy corrections_select on public.corrections for select to authenticated
  using (public.can_read_message(message_id));
create policy corrections_insert on public.corrections for insert to authenticated
  with check (author = (select auth.uid()) and public.can_correct_message(message_id));

-- Live updates for the app (Supabase Realtime applies the policies above to every event).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations, public.messages, public.corrections;
  end if;
end
$$;
