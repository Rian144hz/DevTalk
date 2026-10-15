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
