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
