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
