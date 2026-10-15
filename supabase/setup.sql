-- DevTalk — database setup for a new Supabase project.
-- Generated from supabase/migrations by `npm run build:setup-sql`. Do not edit by hand.
-- Paste the whole file in Supabase › SQL Editor › New query, then click Run. Run it once.

-- ===== 0001_profiles.sql =====

-- DevTalk 0001 — profiles and consents.
-- Every table has row-level security on and explicit grants. `anon` (signed-out requests) gets nothing.

-- Check helpers (immutable, used in check constraints).
create or replace function public.stack_tags_ok(tags text[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(bool_and(char_length(t) between 1 and 30), true) from unnest(tags) as t
$$;

create or replace function public.availability_ok(slots jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case
    when jsonb_typeof(slots) <> 'array' then false
    when jsonb_array_length(slots) > 14 then false
    else coalesce((
      select bool_and(
        jsonb_typeof(s) = 'object'
        and coalesce(s->>'day', '') ~ '^[0-6]$'
        and coalesce(s->>'from', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and coalesce(s->>'to', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and (s->>'from') collate "C" < (s->>'to') collate "C")
      from jsonb_array_elements(slots) as s), true)
  end
$$;

-- Profiles: the public part of an account. The e-mail lives only in auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  native_language text not null check (char_length(btrim(native_language)) between 1 and 60),
  level text not null check (level in ('A2', 'B1', 'B2', 'C1', 'C2')),
  timezone text not null check (char_length(timezone) between 1 and 64),
  area text not null check (area in ('backend', 'frontend', 'mobile', 'data', 'devops', 'other')),
  stack text[] not null default '{}' check (cardinality(stack) <= 10 and public.stack_tags_ok(stack)),
  availability jsonb not null default '[]' check (public.availability_ok(availability)),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_path text check (avatar_path is null or avatar_path = id::text || '/avatar.webp'),
  suspended_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consents: accepted documents, immutable history. `age_18` is the 18+ attestation.
create table public.consents (
  user_id uuid not null references auth.users (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'conduct', 'age_18')),
  version text not null check (char_length(version) between 1 and 20),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

-- Internal helpers (security definer: they read past RLS, so policies can use them without recursion).
-- They take arbitrary user ids, so nobody may call them through the API; only the caller-only wrappers below are exposed.
create or replace function public.is_active(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles p where p.id = uid and p.suspended_until is not null and p.suspended_until > now()
  )
$$;

create or replace function public.has_accepted_documents(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select count(distinct c.document) = 4 from public.consents c where c.user_id = uid
$$;

revoke execute on function public.is_active(uuid), public.has_accepted_documents(uuid) from public, anon, authenticated;

-- Caller-only wrappers: each answers a question about the signed-in person, never about someone else.
create or replace function public.viewer_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.is_active(auth.uid())
$$;

create or replace function public.viewer_has_accepted() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_accepted_documents(auth.uid())
$$;

-- A member: signed in, not suspended, and has accepted the documents and the 18+ attestation.
create or replace function public.viewer_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.is_active(auth.uid()) and public.has_accepted_documents(auth.uid())
$$;

-- Whether the caller may see someone else's profile (0002 adds blocks).
create or replace function public.can_see_profile(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.viewer_is_member() and public.is_active(target)
$$;

-- The caller's own suspension end while it lasts, else null. suspended_until is not readable as a column.
create or replace function public.my_suspension() returns timestamptz
language sql stable security definer set search_path = public as $$
  select p.suspended_until from public.profiles p
  where p.id = auth.uid() and p.suspended_until is not null and p.suspended_until > now()
$$;

revoke execute on function public.viewer_is_active(), public.viewer_has_accepted(), public.viewer_is_member(),
  public.can_see_profile(uuid), public.my_suspension() from public, anon;
grant execute on function public.viewer_is_active(), public.viewer_has_accepted(), public.viewer_is_member(),
  public.can_see_profile(uuid), public.my_suspension() to authenticated;
-- Used by check constraints, which run with the caller's rights.
grant execute on function public.stack_tags_ok(text[]), public.availability_ok(jsonb) to authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Grants. Nobody reads `suspended_until` (own value via my_suspension()) and owners never write it, nor the timestamps.
alter table public.profiles enable row level security;
alter table public.consents enable row level security;

revoke all on public.profiles, public.consents from anon, authenticated;
grant select (id, display_name, native_language, level, timezone, area, stack, availability, bio, avatar_path, created_at, updated_at)
  on public.profiles to authenticated;
grant insert (id, display_name, native_language, level, timezone, area, stack, availability, bio, avatar_path)
  on public.profiles to authenticated;
grant update (id, display_name, native_language, level, timezone, area, stack, availability, bio, avatar_path)
  on public.profiles to authenticated;
grant select on public.consents to authenticated;
grant insert (user_id, document, version) on public.consents to authenticated;

-- Profiles: you see yourself; other members see you while you are active.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.can_see_profile(id));

-- Nothing is written to a profile before the documents and the 18+ attestation are accepted.
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and (select public.viewer_has_accepted()));

create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.viewer_is_active()))
  with check (id = (select auth.uid()));

create policy consents_select on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

create policy consents_insert on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ===== 0002_safety.sql =====

-- DevTalk 0002 — blocks, reports, moderators, moderation actions and notices.

create table public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Reports outlive both accounts: the people involved become null when an account is deleted.
create table public.reports (
  id bigint generated always as identity primary key,
  reporter uuid references auth.users (id) on delete set null,
  reported uuid references auth.users (id) on delete set null,
  context_type text not null check (context_type in ('profile', 'message', 'room')),
  context_id text check (char_length(context_id) <= 100),
  reason text not null check (reason in ('harassment', 'hate', 'sexual', 'spam', 'impersonation', 'minor', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter is null or reported is null or reporter <> reported)
);
create index reports_open on public.reports (created_at) where status = 'open';
create index reports_by_reporter on public.reports (reporter, created_at);

-- Filled by the project owner in the SQL Editor; no client can write it.
create table public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  target uuid references auth.users (id) on delete set null,
  moderator uuid default auth.uid() references auth.users (id) on delete set null,
  action text not null check (action in ('warn', 'suspend', 'unsuspend')),
  reason text not null default '' check (char_length(reason) <= 1000),
  until timestamptz,
  report_id bigint references public.reports (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((action = 'suspend') = (until is not null))
);

create table public.notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Helpers.
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid())
$$;

create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks k
    where (k.blocker = a and k.blocked = b) or (k.blocker = b and k.blocked = a)
  )
$$;

-- is_blocked_between takes arbitrary ids: internal only. is_moderator answers about the caller.
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- Blocked pairs never see each other.
create or replace function public.can_see_profile(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.viewer_is_member() and public.is_active(target) and not public.is_blocked_between(auth.uid(), target)
$$;

-- The moderation actions about the caller (warnings, suspensions), for their own data export.
create or replace function public.my_moderation_actions()
returns table (action text, reason text, until timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.action, a.reason, a.until, a.created_at from public.moderation_actions a
  where a.target = auth.uid() order by a.created_at desc
$$;
revoke execute on function public.my_moderation_actions() from public, anon;
grant execute on function public.my_moderation_actions() to authenticated;

-- At most 20 reports per person in any 24 hours.
create or replace function public.limit_reports() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports r
      where r.reporter = new.reporter and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'report limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;

create trigger reports_limit before insert on public.reports
  for each row execute function public.limit_reports();

-- Who resolved a report, and when, is set by the server, not by the client.
create or replace function public.stamp_report_resolution() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.resolved_by := auth.uid();
    new.resolved_at := case when new.status = 'open' then null else now() end;
  end if;
  return new;
end
$$;

create trigger reports_resolution before update on public.reports
  for each row execute function public.stamp_report_resolution();

-- A moderation action applies itself: suspensions change the profile, warnings become notices,
-- and the linked report is closed.
create or replace function public.apply_moderation_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action = 'suspend' then
    update public.profiles set suspended_until = new.until where id = new.target;
  elsif new.action = 'unsuspend' then
    update public.profiles set suspended_until = null where id = new.target;
  elsif new.action = 'warn' and new.target is not null then
    insert into public.notices (user_id, message) values (new.target, new.reason);
  end if;
  if new.report_id is not null then
    update public.reports set status = 'actioned' where id = new.report_id and status = 'open';
  end if;
  return new;
end
$$;

create trigger moderation_actions_apply after insert on public.moderation_actions
  for each row execute function public.apply_moderation_action();

-- Grants.
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.moderators enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.notices enable row level security;

revoke all on public.blocks, public.reports, public.moderators, public.moderation_actions, public.notices
  from anon, authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocker, blocked) on public.blocks to authenticated;
grant select on public.reports to authenticated;
grant insert (reporter, reported, context_type, context_id, reason, details) on public.reports to authenticated;
grant update (status) on public.reports to authenticated;
grant select on public.moderation_actions to authenticated;
grant insert (target, action, reason, until, report_id) on public.moderation_actions to authenticated;
grant select on public.notices to authenticated;
grant update (read_at) on public.notices to authenticated;

-- Policies.
create policy blocks_select on public.blocks for select to authenticated
  using (blocker = (select auth.uid()));
create policy blocks_insert on public.blocks for insert to authenticated
  with check (blocker = (select auth.uid()) and (select public.viewer_is_member()));
create policy blocks_delete on public.blocks for delete to authenticated
  using (blocker = (select auth.uid()));

create policy reports_select on public.reports for select to authenticated
  using (reporter = (select auth.uid()) or (select public.is_moderator()));
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and reported is not null
    and reported <> (select auth.uid())
    and (select public.viewer_is_member())
  );
create policy reports_update on public.reports for update to authenticated
  using ((select public.is_moderator()) and (select public.viewer_is_active()))
  with check ((select public.is_moderator()) and (select public.viewer_is_active()));

create policy moderation_actions_select on public.moderation_actions for select to authenticated
  using ((select public.is_moderator()));
-- Moderators act only while active, and never on themselves.
create policy moderation_actions_insert on public.moderation_actions for insert to authenticated
  with check (
    (select public.is_moderator())
    and (select public.viewer_is_active())
    and moderator = (select auth.uid())
    and target <> (select auth.uid())
  );

create policy notices_select on public.notices for select to authenticated
  using (user_id = (select auth.uid()));
create policy notices_update on public.notices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Profiles: moderators see everyone; others as can_see_profile says.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_moderator()) or public.can_see_profile(id));

-- ===== 0003_storage.sql =====

-- DevTalk 0003 — private avatars bucket. One file per person: avatars/{user id}/avatar.webp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 204800, array['image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who may read an avatar: its owner always; otherwise a member (active, documents accepted), unless the owner
-- is suspended or the two have blocked each other. Moderators see every avatar.
create or replace function public.can_see_avatar(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  owner_id uuid;
begin
  if me is null or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar\.webp$' then
    return false;
  end if;
  owner_id := split_part(object_name, '/', 1)::uuid;
  if owner_id = me then
    return true;
  end if;
  if not public.viewer_is_member() then
    return false;
  end if;
  return public.is_moderator() or (public.is_active(owner_id) and not public.is_blocked_between(me, owner_id));
end
$$;

revoke execute on function public.can_see_avatar(text) from public, anon;
grant execute on function public.can_see_avatar(text) to authenticated;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_see_avatar(name));

create policy avatars_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.viewer_is_member())
  );

create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.viewer_is_member())
  );

create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== 0004_profile_extras.sql =====

-- DevTalk 0004 — profile extras: badges, practice graph, milestones, banners and mascots.
-- Paste this file alone in the SQL Editor on a project that already ran 0001–0003.

-- Profile columns.
alter table public.profiles
  add column main_stack text[] not null default '{}',
  add column uses_linux boolean not null default false,
  add column show_progress boolean not null default true,
  add column banner_path text,
  add column mascot text;

alter table public.profiles
  add constraint profiles_main_stack_check check (cardinality(main_stack) <= 2 and main_stack <@ stack),
  add constraint profiles_banner_path_check
    check (banner_path is null or banner_path in (id::text || '/banner.gif', id::text || '/banner.webp')),
  add constraint profiles_mascot_check
    check (mascot is null or mascot in ('duck-1', 'duck-2', 'duck-3', 'bear-1', 'bear-2', 'bear-3', 'axolotl-1', 'axolotl-2', 'axolotl-3'));

grant select (main_stack, uses_linux, show_progress, banner_path, mascot) on public.profiles to authenticated;
grant insert (main_stack, uses_linux, show_progress, banner_path, mascot) on public.profiles to authenticated;
grant update (main_stack, uses_linux, show_progress, banner_path, mascot) on public.profiles to authenticated;

-- Practice activity per day (numbers only — never what was written).
create table public.practice_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  answers int not null default 0 check (answers between 0 and 500),
  reviews int not null default 0 check (reviews between 0 and 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create trigger practice_days_touch before update on public.practice_days
  for each row execute function public.touch_updated_at();

-- Evolution milestones reported by the app, with closed values.
create or replace function public.level_up_ok(v text) returns boolean
language sql immutable set search_path = public as $$
  select v ~ '^(A2|B1|B2|C1|C2)>(A2|B1|B2|C1|C2)$'
    and array_position(array['A2', 'B1', 'B2', 'C1', 'C2'], split_part(v, '>', 1))
      < array_position(array['A2', 'B1', 'B2', 'C1', 'C2'], split_part(v, '>', 2))
$$;
grant execute on function public.level_up_ok(text) to authenticated;

create table public.milestones (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('level_up', 'vocabulary')),
  value text not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, kind, value),
  check ((kind = 'vocabulary' and value in ('50', '100')) or (kind = 'level_up' and public.level_up_ok(value)))
);

-- Badges given by hand. Creator is inserted once in the SQL Editor; the others only through moderation actions.
create table public.badge_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge text not null check (badge in ('creator', 'beta_tester', 'mentor', 'open_source')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, badge)
);

-- Moderation actions can give and take the manual badges.
alter table public.moderation_actions
  add column badge text check (badge is null or badge in ('beta_tester', 'mentor', 'open_source'));
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions
  add constraint moderation_actions_action_check
    check (action in ('warn', 'suspend', 'unsuspend', 'grant_badge', 'revoke_badge')),
  add constraint moderation_actions_badge_matches_action
    check ((action in ('grant_badge', 'revoke_badge')) = (badge is not null));
grant insert (badge) on public.moderation_actions to authenticated;

create or replace function public.badge_label(b text) returns text
language sql immutable set search_path = public as $$
  select case b
    when 'creator' then 'Creator' when 'beta_tester' then 'Beta tester' when 'mentor' then 'Mentor'
    when 'open_source' then 'Open source contributor' end
$$;

create or replace function public.apply_moderation_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action = 'suspend' then
    update public.profiles set suspended_until = new.until where id = new.target;
  elsif new.action = 'unsuspend' then
    update public.profiles set suspended_until = null where id = new.target;
  elsif new.action = 'warn' and new.target is not null then
    insert into public.notices (user_id, message) values (new.target, new.reason);
  elsif new.action = 'grant_badge' and new.target is not null then
    insert into public.badge_grants (user_id, badge, granted_by) values (new.target, new.badge, new.moderator)
      on conflict (user_id, badge) do nothing;
    insert into public.notices (user_id, message) values (new.target, 'You received the ' || public.badge_label(new.badge) || ' badge.');
  elsif new.action = 'revoke_badge' and new.target is not null then
    delete from public.badge_grants where user_id = new.target and badge = new.badge;
  end if;
  if new.report_id is not null then
    update public.reports set status = 'actioned' where id = new.report_id and status = 'open';
  end if;
  return new;
end
$$;

-- Visibility of someone's progress for the caller: the owner always; others when they can see the profile
-- and the owner shows their progress.
create or replace function public.can_see_progress(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    target = auth.uid()
    or (public.can_see_profile(target)
        and coalesce((select p.show_progress from public.profiles p where p.id = target), false))
  )
$$;
revoke execute on function public.can_see_progress(uuid) from public, anon;
grant execute on function public.can_see_progress(uuid) to authenticated;

-- A time zone name Postgres knows, else UTC.
create or replace function public.safe_time_zone(tz text) returns text
language sql stable set search_path = public as $$
  select case when exists (select 1 from pg_timezone_names where name = tz) then tz else 'UTC' end
$$;

-- Current streak (ending today or yesterday in the profile's time zone) and the longest one. Internal.
create or replace function public.practice_streak_values(target uuid)
returns table (current int, longest int)
language sql stable security definer set search_path = public as $$
  with today as (
    select (now() at time zone public.safe_time_zone(coalesce((select p.timezone from public.profiles p where p.id = target), 'UTC')))::date as d
  ),
  active as (
    select d.day from public.practice_days d where d.user_id = target and d.answers + d.reviews > 0
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

-- Streaks of someone the caller may see progress of; no row otherwise.
create or replace function public.practice_streaks(target uuid)
returns table (current int, longest int)
language sql stable security definer set search_path = public as $$
  select s.current, s.longest from public.practice_streak_values(target) s where public.can_see_progress(target)
$$;
revoke execute on function public.practice_streaks(uuid) from public, anon;
grant execute on function public.practice_streaks(uuid) to authenticated;

-- Every badge of a profile the caller may see, in display order: community, technical, language, evolution.
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

-- Grants and policies.
alter table public.practice_days enable row level security;
alter table public.milestones enable row level security;
alter table public.badge_grants enable row level security;

revoke all on public.practice_days, public.milestones, public.badge_grants from anon, authenticated;
grant select on public.practice_days to authenticated;
grant insert (user_id, day, answers, reviews) on public.practice_days to authenticated;
grant update (user_id, day, answers, reviews) on public.practice_days to authenticated;
grant select on public.milestones to authenticated;
grant insert (user_id, kind, value) on public.milestones to authenticated;

create policy practice_days_select on public.practice_days for select to authenticated
  using (public.can_see_progress(user_id));
create policy practice_days_insert on public.practice_days for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.viewer_is_member())
    and day between current_date - 400 and current_date + 1
  );
create policy practice_days_update on public.practice_days for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (select public.viewer_is_member())
    and day between current_date - 400 and current_date + 1
  );

create policy milestones_select on public.milestones for select to authenticated
  using (public.can_see_progress(user_id));
create policy milestones_insert on public.milestones for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.viewer_is_member()));

-- Banners: one file per person, banners/{user id}/banner.gif or banner.webp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', false, 2097152, array['image/gif', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_see_banner(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  owner_id uuid;
begin
  if me is null or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/banner\.(gif|webp)$' then
    return false;
  end if;
  owner_id := split_part(object_name, '/', 1)::uuid;
  if owner_id = me then
    return true;
  end if;
  if not public.viewer_is_member() then
    return false;
  end if;
  return public.is_moderator() or (public.is_active(owner_id) and not public.is_blocked_between(me, owner_id));
end
$$;
revoke execute on function public.can_see_banner(text) from public, anon;
grant execute on function public.can_see_banner(text) to authenticated;

create policy banners_read on storage.objects for select to authenticated
  using (bucket_id = 'banners' and public.can_see_banner(name));
create policy banners_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'banners'
    and name in ((select auth.uid())::text || '/banner.gif', (select auth.uid())::text || '/banner.webp')
    and (select public.viewer_is_member())
  );
create policy banners_update on storage.objects for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'banners'
    and name in ((select auth.uid())::text || '/banner.gif', (select auth.uid())::text || '/banner.webp')
    and (select public.viewer_is_member())
  );
create policy banners_delete on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== 0005_review_fixes.sql =====

-- DevTalk 0005 — profile extras after review: other members see how much someone practised, never when;
-- "Export my data" includes badges and progress. Paste alone in the SQL Editor on a project with 0001–0004.

-- Numbers only: the update and achievement times are no longer readable through the API.
-- (Revoking the table privilege also removes column privileges; the needed columns are granted again.)
revoke select on public.practice_days, public.milestones from authenticated;
grant select (user_id, day, answers, reviews) on public.practice_days to authenticated;
grant select (user_id, kind, value) on public.milestones to authenticated;

-- The caller's own moderation records, now with the badge given or taken. The return type changes, so it is recreated.
drop function public.my_moderation_actions();
create function public.my_moderation_actions()
returns table (action text, reason text, until timestamptz, badge text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.action, a.reason, a.until, a.badge, a.created_at from public.moderation_actions a
  where a.target = auth.uid() order by a.created_at desc
$$;
revoke execute on function public.my_moderation_actions() from public, anon;
grant execute on function public.my_moderation_actions() to authenticated;

-- The caller's own practice days and milestones, with their times, for "Export my data".
create function public.my_progress_export() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'practiceDays', coalesce((
      select json_agg(json_build_object('day', d.day, 'answers', d.answers, 'reviews', d.reviews, 'updatedAt', d.updated_at) order by d.day)
      from public.practice_days d where d.user_id = auth.uid()
    ), '[]'::json),
    'milestones', coalesce((
      select json_agg(json_build_object('kind', m.kind, 'value', m.value, 'achievedAt', m.achieved_at) order by m.achieved_at)
      from public.milestones m where m.user_id = auth.uid()
    ), '[]'::json)
  )
$$;
revoke execute on function public.my_progress_export() from public, anon;
grant execute on function public.my_progress_export() to authenticated;
