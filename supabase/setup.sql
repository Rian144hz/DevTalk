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

-- ===== 0006_people.sql =====

-- DevTalk 0006 — people: follows, profile likes, the member list and the social readers.
-- Paste this file alone in the SQL Editor on a project that already ran 0001–0005.

-- A person can leave the member list; their profile stays reachable through follower lists or a link.
alter table public.profiles add column listed boolean not null default true;
grant select (listed) on public.profiles to authenticated;
grant insert (listed) on public.profiles to authenticated;
grant update (listed) on public.profiles to authenticated;

-- Notices say what they are about and who caused them.
alter table public.notices
  add column kind text not null default 'moderation' check (kind in ('moderation', 'follow')),
  add column actor uuid references auth.users (id) on delete set null;

create table public.follows (
  follower uuid not null references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index follows_followee on public.follows (followee);

create table public.profile_likes (
  liker uuid not null references auth.users (id) on delete cascade,
  profile uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker, profile),
  check (liker <> profile)
);
create index profile_likes_profile on public.profile_likes (profile);

-- At most 200 new follows and 200 new likes per person in any 24 hours.
create or replace function public.limit_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.follows f
      where f.follower = new.follower and f.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'follow limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;
create trigger follows_limit before insert on public.follows
  for each row execute function public.limit_follows();

create or replace function public.limit_likes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.profile_likes l
      where l.liker = new.liker and l.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'like limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;
create trigger profile_likes_limit before insert on public.profile_likes
  for each row execute function public.limit_likes();

-- A follow tells the person, at most once a week per follower (following again does not spam).
create or replace function public.notify_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.notices n
    where n.user_id = new.followee and n.kind = 'follow' and n.actor = new.follower
      and n.created_at > now() - interval '7 days'
  ) then
    insert into public.notices (user_id, kind, actor, message)
    values (new.followee, 'follow', new.follower,
      coalesce((select p.display_name from public.profiles p where p.id = new.follower), 'A member') || ' followed you.');
  end if;
  return new;
end
$$;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_follow();

-- Blocking someone ends the follows and likes between the two, both ways.
create or replace function public.clear_ties_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
    where (follower = new.blocker and followee = new.blocked) or (follower = new.blocked and followee = new.blocker);
  delete from public.profile_likes
    where (liker = new.blocker and profile = new.blocked) or (liker = new.blocked and profile = new.blocker);
  return new;
end
$$;
create trigger blocks_clear_ties after insert on public.blocks
  for each row execute function public.clear_ties_on_block();

revoke execute on function public.limit_follows(), public.limit_likes(), public.notify_follow(), public.clear_ties_on_block()
  from public, anon, authenticated;

-- Grants and policies: members write and delete their own rows and read only their own rows;
-- everything about other people is read through the functions below.
alter table public.follows enable row level security;
alter table public.profile_likes enable row level security;
revoke all on public.follows, public.profile_likes from anon, authenticated;
grant select (follower, followee, created_at), delete on public.follows to authenticated;
grant insert (follower, followee) on public.follows to authenticated;
grant select (liker, profile, created_at), delete on public.profile_likes to authenticated;
grant insert (liker, profile) on public.profile_likes to authenticated;

create policy follows_select on public.follows for select to authenticated
  using (follower = (select auth.uid()));
create policy follows_insert on public.follows for insert to authenticated
  with check (
    follower = (select auth.uid())
    and (select public.viewer_is_member())
    and public.can_see_profile(followee)
    and exists (select 1 from public.profiles p where p.id = followee)
  );
create policy follows_delete on public.follows for delete to authenticated
  using (follower = (select auth.uid()));

create policy profile_likes_select on public.profile_likes for select to authenticated
  using (liker = (select auth.uid()));
create policy profile_likes_insert on public.profile_likes for insert to authenticated
  with check (
    liker = (select auth.uid())
    and (select public.viewer_is_member())
    and public.can_see_profile(profile)
    and exists (select 1 from public.profiles p where p.id = profile)
  );
create policy profile_likes_delete on public.profile_likes for delete to authenticated
  using (liker = (select auth.uid()));

-- Whether `other` counts for the caller: not suspended and no block between them.
create or replace function public.counts_for_viewer(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active(other) and not public.is_blocked_between(auth.uid(), other)
$$;
revoke execute on function public.counts_for_viewer(uuid) from public, anon, authenticated;

-- Followers, following and likes of a profile, and whether the caller follows or likes it.
-- Zeros when the caller cannot see the profile.
create or replace function public.profile_social(target uuid)
returns table (followers int, following int, likes int, i_follow boolean, i_like boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (target = auth.uid() or public.can_see_profile(target)) then
    return query select 0, 0, 0, false, false;
    return;
  end if;
  return query select
    (select count(*)::int from public.follows f where f.followee = target and public.counts_for_viewer(f.follower)),
    (select count(*)::int from public.follows f where f.follower = target and public.counts_for_viewer(f.followee)),
    (select count(*)::int from public.profile_likes l where l.profile = target and public.counts_for_viewer(l.liker)),
    exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = target),
    exists (select 1 from public.profile_likes l where l.liker = auth.uid() and l.profile = target);
end
$$;

-- The member list: listed, active members the caller is not blocked with, closest English level first.
-- `q` is matched literally inside the display name; `stack_tag` ignores case.
create or replace function public.member_directory(q text, lvl text, area_filter text, stack_tag text, page int)
returns table (id uuid, display_name text, level text, area text, main_stack text[], mascot text, has_avatar boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.level, p.area, p.main_stack, p.mascot, p.avatar_path is not null
  from public.profiles p
  where public.viewer_is_member()
    and p.id <> auth.uid()
    and p.listed
    and public.counts_for_viewer(p.id)
    and (coalesce(q, '') = ''
      or p.display_name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and (lvl is null or p.level = lvl)
    and (area_filter is null or p.area = area_filter)
    and (stack_tag is null or exists (select 1 from unnest(p.stack) s(tag) where lower(s.tag) = lower(stack_tag)))
  order by
    abs(array_position(array['A2', 'B1', 'B2', 'C1', 'C2'], p.level)
      - coalesce(array_position(array['A2', 'B1', 'B2', 'C1', 'C2'],
          (select me.level from public.profiles me where me.id = auth.uid())), 2)),
    p.display_name, p.id
  limit 30 offset greatest(coalesce(page, 0), 0) * 30
$$;

-- Who follows `target`, and whom `target` follows, for callers who can see `target`.
create or replace function public.followers_of(target uuid, page int)
returns table (id uuid, display_name text, level text, area text, main_stack text[], mascot text, has_avatar boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.level, p.area, p.main_stack, p.mascot, p.avatar_path is not null
  from public.follows f join public.profiles p on p.id = f.follower
  where f.followee = target
    and (target = auth.uid() or public.can_see_profile(target))
    and public.counts_for_viewer(p.id)
  order by p.display_name, p.id
  limit 30 offset greatest(coalesce(page, 0), 0) * 30
$$;

create or replace function public.following_of(target uuid, page int)
returns table (id uuid, display_name text, level text, area text, main_stack text[], mascot text, has_avatar boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.level, p.area, p.main_stack, p.mascot, p.avatar_path is not null
  from public.follows f join public.profiles p on p.id = f.followee
  where f.follower = target
    and (target = auth.uid() or public.can_see_profile(target))
    and public.counts_for_viewer(p.id)
  order by p.display_name, p.id
  limit 30 offset greatest(coalesce(page, 0), 0) * 30
$$;

-- The caller's own follows, followers and likes given, with dates, for "Export my data".
create or replace function public.my_social_export() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'following', coalesce((select json_agg(json_build_object('id', f.followee, 'at', f.created_at) order by f.created_at)
      from public.follows f where f.follower = auth.uid()), '[]'::json),
    'followers', coalesce((select json_agg(json_build_object('id', f.follower, 'at', f.created_at) order by f.created_at)
      from public.follows f where f.followee = auth.uid()), '[]'::json),
    'likesGiven', coalesce((select json_agg(json_build_object('id', l.profile, 'at', l.created_at) order by l.created_at)
      from public.profile_likes l where l.liker = auth.uid()), '[]'::json)
  )
$$;

revoke execute on function public.profile_social(uuid), public.member_directory(text, text, text, text, int),
  public.followers_of(uuid, int), public.following_of(uuid, int), public.my_social_export() from public, anon;
grant execute on function public.profile_social(uuid), public.member_directory(text, text, text, text, int),
  public.followers_of(uuid, int), public.following_of(uuid, int), public.my_social_export() to authenticated;

-- ===== 0007_people_review.sql =====

-- DevTalk 0007 — people, after review: follow notices leave with the follower's account, following and
-- unfollowing in a loop still hits the daily limit, and only members with a profile follow or like.
-- Paste this file alone in the SQL Editor on a project that already ran 0001–0006.

-- A deleted account takes its "<name> followed you." notices with it (the name was part of the message).
alter table public.notices drop constraint notices_actor_fkey;
alter table public.notices
  add constraint notices_actor_fkey foreign key (actor) references auth.users (id) on delete cascade;
create index notices_follow_actor on public.notices (actor, created_at) where kind = 'follow';

-- The limit also counts follow notices sent in the last 24 hours, which an unfollow cannot take back.
create or replace function public.limit_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.follows f
      where f.follower = new.follower and f.created_at > now() - interval '24 hours') >= 200
    or (select count(*) from public.notices n
      where n.actor = new.follower and n.kind = 'follow' and n.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'follow limit reached' using hint = 'Try again tomorrow.';
  end if;
  return new;
end
$$;
revoke execute on function public.limit_follows() from public, anon, authenticated;

-- Following or liking needs a profile of your own too, not only the documents.
drop policy follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated
  with check (
    follower = (select auth.uid())
    and (select public.viewer_is_member())
    and exists (select 1 from public.profiles me where me.id = (select auth.uid()))
    and public.can_see_profile(followee)
    and exists (select 1 from public.profiles p where p.id = followee)
  );

drop policy profile_likes_insert on public.profile_likes;
create policy profile_likes_insert on public.profile_likes for insert to authenticated
  with check (
    liker = (select auth.uid())
    and (select public.viewer_is_member())
    and exists (select 1 from public.profiles me where me.id = (select auth.uid()))
    and public.can_see_profile(profile)
    and exists (select 1 from public.profiles p where p.id = profile)
  );

-- ===== 0008_chat.sql =====

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

-- The caller's conversations and requests, newest first. The preview is null when the last message was deleted.
-- A request you declined disappears for you; for the person who asked it stays "pending".
create or replace function public.my_conversations()
returns table (id uuid, other_id uuid, other_name text, other_has_avatar boolean, other_mascot text, status text,
  requested_by_me boolean, preview text, last_message_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, p.id, p.display_name, p.avatar_path is not null, p.mascot,
    case when c.status = 'declined' then 'pending' else c.status end,
    c.requested_by = auth.uid(),
    (select case when m.deleted_at is null then left(m.body, 140) end
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
