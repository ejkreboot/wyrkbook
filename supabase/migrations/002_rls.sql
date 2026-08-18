-- wyrkbook: row level security
-- Privilege model: sysadmin > admin (org-scoped) > student (org-scoped, own work only).
-- Helpers are SECURITY DEFINER so reading `profile` inside a `profile` policy does not recurse.

-- ---------------------------------------------------------------- helpers

create or replace function wb_role() returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select role from profile where id = auth.uid()
$$;

create or replace function wb_org() returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select org_id from profile where id = auth.uid()
$$;

create or replace function wb_is_sysadmin() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'sysadmin' from profile where id = auth.uid()), false)
$$;

create or replace function wb_is_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role in ('admin','sysadmin') from profile where id = auth.uid()), false)
$$;

revoke execute on function wb_role(), wb_org(), wb_is_sysadmin(), wb_is_admin() from public;
grant  execute on function wb_role(), wb_org(), wb_is_sysadmin(), wb_is_admin() to authenticated;

-- ---------------------------------------------------------------- enable RLS

alter table organization    enable row level security;
alter table profile         enable row level security;
alter table class           enable row level security;
alter table assignment      enable row level security;
alter table weekly_goal     enable row level security;
alter table problem         enable row level security;
alter table submission      enable row level security;
alter table submission_page enable row level security;
alter table problem_result  enable row level security;
alter table hint_request    enable row level security;

-- ---------------------------------------------------------------- organization
-- Only sysadmins create organizations. Members can read their own.

create policy org_sysadmin_all on organization
  for all to authenticated using (wb_is_sysadmin()) with check (wb_is_sysadmin());

create policy org_member_read on organization
  for select to authenticated using (id = wb_org());

-- ---------------------------------------------------------------- profile
-- Sysadmins manage everyone. Admins manage students+admins in their org.
-- Everyone can read their own row.

create policy profile_sysadmin_all on profile
  for all to authenticated using (wb_is_sysadmin()) with check (wb_is_sysadmin());

create policy profile_self_read on profile
  for select to authenticated using (id = auth.uid());

create policy profile_org_read on profile
  for select to authenticated using (org_id = wb_org());

create policy profile_admin_write on profile
  for insert to authenticated
  with check (wb_role() = 'admin' and org_id = wb_org() and role in ('admin','student'));

create policy profile_admin_update on profile
  for update to authenticated
  using  (wb_role() = 'admin' and org_id = wb_org() and role in ('admin','student'))
  with check (wb_role() = 'admin' and org_id = wb_org() and role in ('admin','student'));

create policy profile_admin_delete on profile
  for delete to authenticated
  using (wb_role() = 'admin' and org_id = wb_org() and role = 'student');

-- ---------------------------------------------------------------- class
-- Admins write; everyone in the org reads.

create policy class_read on class
  for select to authenticated using (org_id = wb_org() or wb_is_sysadmin());

create policy class_admin_write on class
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ---------------------------------------------------------------- weekly_goal

create policy goal_read on weekly_goal
  for select to authenticated using (org_id = wb_org() or wb_is_sysadmin());

create policy goal_admin_write on weekly_goal
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ---------------------------------------------------------------- assignment
-- Admins see everything in their org. Students see published assignments only —
-- any student may work any published assignment (no roster by design).

create policy assignment_admin_all on assignment
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

create policy assignment_student_read on assignment
  for select to authenticated
  using (org_id = wb_org() and status = 'published');

-- ---------------------------------------------------------------- problem
-- Students only ever see problems the teacher kept (`included`).

create policy problem_admin_all on problem
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

create policy problem_student_read on problem
  for select to authenticated
  using (
    org_id = wb_org() and included
    and exists (select 1 from assignment a
                where a.id = problem.assignment_id and a.status = 'published')
  );

-- ---------------------------------------------------------------- submission
-- Students own their attempts. Admins read/grade everything in the org.

create policy submission_student_read on submission
  for select to authenticated using (student_id = auth.uid());

create policy submission_student_insert on submission
  for insert to authenticated
  with check (student_id = auth.uid() and org_id = wb_org());

-- A student may edit only an attempt that has not been submitted yet.
create policy submission_student_update on submission
  for update to authenticated
  using  (student_id = auth.uid() and status = 'in_progress')
  with check (student_id = auth.uid());

create policy submission_admin_all on submission
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ---------------------------------------------------------------- submission_page

create policy page_student_rw on submission_page
  for all to authenticated
  using (exists (select 1 from submission s
                 where s.id = submission_page.submission_id and s.student_id = auth.uid()))
  with check (exists (select 1 from submission s
                      where s.id = submission_page.submission_id
                        and s.student_id = auth.uid() and s.status = 'in_progress'));

create policy page_admin_all on submission_page
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ---------------------------------------------------------------- problem_result
-- Students read their own results but never write them — grading is server-side.

create policy result_student_read on problem_result
  for select to authenticated
  using (exists (select 1 from submission s
                 where s.id = problem_result.submission_id and s.student_id = auth.uid()));

create policy result_admin_all on problem_result
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ---------------------------------------------------------------- hint_request
-- Students read their own hints; the hint text itself is written server-side.

create policy hint_student_read on hint_request
  for select to authenticated using (student_id = auth.uid());

create policy hint_admin_all on hint_request
  for all to authenticated
  using  (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
  with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));
