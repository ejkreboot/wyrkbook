-- wyrkbook: class rosters
--
-- Reverses the "deliberately no roster" decision in migration 001. Weekly goals
-- and published assignments were org-wide: every student saw every class's work.
-- That is fine for one student and wrong for two, so a class now has a roster and
-- a student sees only what their classes carry.
--
-- The join row is the whole feature. Everything else here is RLS rewritten to
-- read it, which is where the care is needed — the roster has to gate students
-- without stranding work that was already started.

-- ---------------------------------------------------------------- enrollment

create table enrollment (
	id          uuid primary key default gen_random_uuid(),
	org_id      uuid not null references organization(id) on delete cascade,
	class_id    uuid not null references class(id) on delete cascade,
	student_id  uuid not null references profile(id) on delete cascade,
	created_at  timestamptz not null default now(),
	unique (class_id, student_id)
);
create index enrollment_class_idx   on enrollment(class_id);
create index enrollment_student_idx on enrollment(student_id);
create index enrollment_org_idx     on enrollment(org_id);

alter table enrollment enable row level security;

-- ---------------------------------------------------------------- helpers

/*
 * SECURITY DEFINER for the same reason wb_role() is: `enrollment_student_read`
 * is a policy *on* enrollment, so a policy elsewhere that reads enrollment
 * through an ordinary subquery would re-enter that policy. A definer function
 * reads the table with RLS off and returns a plain boolean.
 */

create or replace function wb_enrolled(p_class_id uuid) returns boolean
	language sql stable security definer set search_path = public, pg_temp as $$
	select exists (
		select 1 from enrollment e
		where e.class_id = p_class_id and e.student_id = auth.uid()
	)
$$;

/*
 * May the caller work this assignment? Published, in their org, and either they
 * are on the roster of its class *or* they already have a submission against it.
 *
 * The second arm is the grandfather clause, and it is not a nicety: without it,
 * unenrolling a student mid-assignment makes the assignment, its problems and
 * their own in-progress work vanish from under them — RLS would hide the
 * assignment row their session hangs off. A student who has started stays able
 * to finish; the roster governs what they can *pick up*.
 */
create or replace function wb_can_work(p_assignment_id uuid) returns boolean
	language sql stable security definer set search_path = public, pg_temp as $$
	select exists (
		select 1 from assignment a
		where a.id = p_assignment_id
		  and a.status = 'published'
		  and a.org_id = (select org_id from profile where id = auth.uid())
		  and (
		    exists (select 1 from enrollment e
		            where e.class_id = a.class_id and e.student_id = auth.uid())
		    or exists (select 1 from submission s
		               where s.assignment_id = a.id and s.student_id = auth.uid())
		  )
	)
$$;

revoke execute on function wb_enrolled(uuid), wb_can_work(uuid) from public;
grant  execute on function wb_enrolled(uuid), wb_can_work(uuid) to authenticated;

-- ---------------------------------------------------------------- enrollment policies

-- Teachers hold the roster. A student may read their own rows and nothing else:
-- the student surface groups goals by class, and that needs the join.
create policy enrollment_admin_all on enrollment
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

create policy enrollment_student_read on enrollment
	for select to authenticated
	using (student_id = auth.uid());

grant select, insert, update, delete on enrollment to authenticated;
revoke all on enrollment from anon;

-- ---------------------------------------------------------------- weekly_goal

-- Migration 004 narrowed goals to admins with a note saying to widen this one
-- policy if goals were ever shown to students. This is that, scoped by roster
-- rather than by org.
create policy goal_student_read on weekly_goal
	for select to authenticated
	using (org_id = wb_org() and wb_enrolled(class_id));

-- ---------------------------------------------------------------- assignment

drop policy assignment_student_read on assignment;
create policy assignment_student_read on assignment
	for select to authenticated
	using (org_id = wb_org() and status = 'published' and wb_can_work(id));

-- ---------------------------------------------------------------- problem

drop policy problem_student_read on problem;
create policy problem_student_read on problem
	for select to authenticated
	using (org_id = wb_org() and included and wb_can_work(problem.assignment_id));

-- ---------------------------------------------------------------- submission

/*
 * Starting work needs the roster proper. wb_can_work() also passes on "already
 * has a submission", which cannot be true for the row being inserted, so the
 * first attempt is gated by enrollment alone — which is the point.
 */
drop policy submission_student_insert on submission;
create policy submission_student_insert on submission
	for insert to authenticated
	with check (
		student_id = auth.uid()
		and org_id = wb_org()
		and wb_can_work(submission.assignment_id)
	);
