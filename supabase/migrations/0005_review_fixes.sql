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
