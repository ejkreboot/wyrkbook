-- wyrkbook: RLS hardening
--
-- Fixes found by an audit of the initial policy set. Four real problems, all
-- confirmed against the live database with a rolled-back transaction:
--
--   1. Answers and answer keys were readable by students. RLS is row-level, and
--      PostgREST lets a client select any column of a row it can see — so
--      `?select=answer` returned every answer for any published assignment.
--   2. Students could UPDATE their own submission, which meant setting
--      score = 100, status = 'graded', hint_penalty_total = 0.
--   3. Students could open a submission against an unpublished draft.
--   4. Every student could read every profile in the org, including emails.

-- ================================================================ 1. answers

/*
 * Answers move to sidecar tables that students have no policy on at all.
 * Column-level GRANTs cannot solve this: admins and students are both the
 * `authenticated` role, so there is no grant that separates them. Splitting the
 * rows is the only way to make "students cannot read answers" true at the
 * database level rather than by convention in the query layer.
 */

create table problem_answer (
	problem_id uuid primary key references problem(id) on delete cascade,
	org_id     uuid not null references organization(id) on delete cascade,
	answer     text,
	created_at timestamptz not null default now()
);
create index problem_answer_org_idx on problem_answer(org_id);

create table assignment_key (
	assignment_id uuid primary key references assignment(id) on delete cascade,
	org_id        uuid not null references organization(id) on delete cascade,
	answer_key    text,
	created_at    timestamptz not null default now()
);
create index assignment_key_org_idx on assignment_key(org_id);

insert into problem_answer (problem_id, org_id, answer)
select id, org_id, answer from problem where answer is not null and answer <> '';

insert into assignment_key (assignment_id, org_id, answer_key)
select id, org_id, answer_key from assignment where answer_key is not null and answer_key <> '';

alter table problem    drop column answer;
alter table assignment drop column answer_key;

alter table problem_answer  enable row level security;
alter table assignment_key  enable row level security;

-- Admins only. The deliberate absence of any student policy is the protection;
-- grading reads these through the service role, which bypasses RLS.
create policy problem_answer_admin_all on problem_answer
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

create policy assignment_key_admin_all on assignment_key
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ================================================================ 2. submission writes

/*
 * Every write to a submission after creation is a grade or a hint penalty, and
 * both are written server-side with the service role. A student therefore needs
 * no UPDATE at all — the previous policy let them award themselves any score.
 */
drop policy submission_student_update on submission;

-- Starting work is still the student's own action, but only on an assignment
-- their teacher has actually published.
drop policy submission_student_insert on submission;
create policy submission_student_insert on submission
	for insert to authenticated
	with check (
		student_id = auth.uid()
		and org_id = wb_org()
		and exists (
			select 1 from assignment a
			where a.id = submission.assignment_id
			  and a.status = 'published'
			  and a.org_id = wb_org()
		)
	);

-- ================================================================ 3. work pages

-- Pages are uploaded by the grading endpoint under the service role, so the
-- student side only ever needs to read its own.
drop policy page_student_rw on submission_page;
create policy page_student_read on submission_page
	for select to authenticated
	using (
		exists (
			select 1 from submission s
			where s.id = submission_page.submission_id
			  and s.student_id = auth.uid()
		)
	);

-- ================================================================ 4. profiles

-- Students have no reason to enumerate their classmates or their teachers'
-- email addresses; `profile_self_read` still covers their own row.
drop policy profile_org_read on profile;
create policy profile_admin_read on profile
	for select to authenticated
	using (wb_is_admin() and org_id = wb_org());

-- ================================================================ 5. weekly goals

-- No student surface reads goals today. Narrow it to admins; if goals are ever
-- shown to students, widen this one policy back to `org_id = wb_org()`.
drop policy goal_read on weekly_goal;
create policy goal_admin_read on weekly_goal
	for select to authenticated
	using (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

-- ================================================================ 6. anon

-- Nothing in wyrkbook is public. Signing in goes through GoTrue, not PostgREST,
-- so the anonymous role needs no table access whatsoever.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant select, insert, update, delete on problem_answer, assignment_key to authenticated;
