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
