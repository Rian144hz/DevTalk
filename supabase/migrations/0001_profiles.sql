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
