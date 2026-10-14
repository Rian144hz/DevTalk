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
