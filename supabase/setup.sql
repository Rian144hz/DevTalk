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
