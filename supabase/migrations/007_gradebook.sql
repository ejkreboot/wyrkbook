-- wyrkbook: the gradebook
--
-- Two tables, and the split between them is the feature. `grade_item` is a
-- column in the book — a thing worth points, belonging to a class. `grade` is a
-- cell — one student's mark against one column. Everything else, the course
-- total included, is derived at read time.
--
-- A column arrives one of two ways. Either the teacher assigned something
-- outside the system — a page of a workbook, an oral quiz, a nature walk — and
-- types the column in by hand, or the column stands for an assignment this app
-- already knows about, in which case `assignment_id` points at it and grading a
-- submission fills the cells in without anyone typing.
--
-- There is no due date here on purpose. A due date belongs to the assignment,
-- and an outside item does not have one worth recording.

-- ---------------------------------------------------------------- grade_item

create table grade_item (
	id              uuid primary key default gen_random_uuid(),
	org_id          uuid not null references organization(id) on delete cascade,
	class_id        uuid not null references class(id) on delete cascade,

	/*
	 * Null for an item the teacher typed in. `set null` rather than `cascade`,
	 * matching weekly_goal: deleting an assignment is a tidy-up of this app's own
	 * paperwork, and it must not take a term of earned marks with it. When the
	 * assignment goes the column degrades into exactly the thing it would have
	 * been had the teacher typed it — title, points, marks — which is a shape the
	 * feature already supports. Nothing is lost but the link.
	 */
	assignment_id   uuid references assignment(id) on delete set null,

	title           text not null,
	points_possible numeric not null default 10 check (points_possible > 0),
	sort_order      int not null default 0,
	created_at      timestamptz not null default now()
);

create index grade_item_class_idx on grade_item(class_id, sort_order);
create index grade_item_org_idx   on grade_item(org_id);

/*
 * One column per assignment. Keyed on the assignment alone rather than on
 * (class_id, assignment_id): an assignment already belongs to exactly one class,
 * so the pair could only ever disagree with itself, and the narrower index makes
 * the sync's find-or-create a maybeSingle() lookup that cannot surprise it.
 * Partial, because hand-typed items all carry null and null is not unique.
 */
create unique index grade_item_assignment_uniq
	on grade_item(assignment_id) where assignment_id is not null;

-- ---------------------------------------------------------------- grade

create table grade (
	id             uuid primary key default gen_random_uuid(),
	org_id         uuid not null references organization(id) on delete cascade,
	grade_item_id  uuid not null references grade_item(id) on delete cascade,
	student_id     uuid not null references profile(id) on delete cascade,

	/*
	 * Nullable, and the null carries meaning. The course total is
	 * sum(earned)/sum(possible) over items that actually carry a mark, so an
	 * ungraded cell must be absent from the sum rather than a zero — a not-null
	 * column defaulting to 0 would drop the whole class to failing the moment a
	 * new column appeared.
	 *
	 * Two shades of ungraded, deliberately indistinguishable to the arithmetic:
	 * no row at all means nobody has looked yet, and a row with a null means the
	 * teacher looked and cleared it. The second is what "excused" means here — it
	 * survives, it is source='manual', and so the grader will not fill it back
	 * in. That is the whole of excused. There is no separate flag and no
	 * missing/late vocabulary, because home school does not need one.
	 */
	points_earned  numeric check (points_earned >= 0),

	/*
	 * Who last had an opinion, and a precedence rule rather than a label. 'auto'
	 * is a snapshot written by the grading endpoint; 'manual' is a teacher and
	 * outranks it permanently — a later auto write skips any row that says
	 * manual. There is no third value: a mark is either something a machine
	 * worked out or something a person decided.
	 */
	source         text not null default 'manual' check (source in ('manual','auto')),

	/*
	 * The submission this mark was snapshotted from, when there was one.
	 * `set null` so deleting a submission does not delete the grade it produced —
	 * the mark outlives the photos. Kept even after a teacher overrides the cell,
	 * because the student's result page is still the evidence behind the number.
	 */
	submission_id  uuid references submission(id) on delete set null,

	-- No triggers anywhere in this schema, so both writers set this by hand.
	updated_at     timestamptz not null default now(),
	created_at     timestamptz not null default now(),

	unique (grade_item_id, student_id)
);

-- The unique constraint already indexes the item side, so only these two.
create index grade_student_idx on grade(student_id);
create index grade_org_idx     on grade(org_id);

-- ---------------------------------------------------------------- policies

alter table grade_item enable row level security;
alter table grade      enable row level security;

create policy grade_item_admin_all on grade_item
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

/*
 * A student needs the column to read their own cell: a mark of 8 means nothing
 * without "Chapter 4 quiz, out of 10". Scoped by roster, like goal_student_read.
 *
 * The second arm is the same grandfather clause wb_can_work() carries, for the
 * same reason. Unenrolling a student at the end of a term would otherwise strip
 * the titles off marks they still hold, leaving a grade page of bare numbers.
 * Written as a plain exists() rather than a definer function because there is no
 * recursion to dodge: grade's own policies read auth.uid() and never grade_item,
 * so entering them from here is safe — and for a student they return only their
 * own rows, which is exactly the filter wanted.
 */
create policy grade_item_student_read on grade_item
	for select to authenticated
	using (
		org_id = wb_org()
		and (
			wb_enrolled(class_id)
			or exists (
				select 1 from grade g
				where g.grade_item_id = grade_item.id and g.student_id = auth.uid()
			)
		)
	);

create policy grade_admin_all on grade
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

/*
 * Read-only, and the absence of any write policy is the point: a grade is the
 * one number a student has every incentive to edit. This is the rule migration
 * 004 settled for submission, applied here unchanged. Auto marks are written
 * with the service role from the grading endpoint; teacher marks with the
 * teacher's own client under the policy above.
 */
create policy grade_student_read on grade
	for select to authenticated
	using (student_id = auth.uid());

grant select, insert, update, delete on grade_item, grade to authenticated;
revoke all on grade_item, grade from anon;

-- ---------------------------------------------------------------- backfill
--
-- Every assignment that has ever been graded gets its column, and every graded
-- submission its cell. Without this the book opens empty despite a term of
-- work, and there is no other route to it — the sync in $lib/server/gradebook.ts
-- only fires on the next grading. One-time; from here that sync keeps up.

insert into grade_item (org_id, class_id, assignment_id, title, points_possible, sort_order)
select a.org_id, a.class_id, a.id, a.title,
	/*
	 * greatest(): an assignment whose problems were all excluded after it was
	 * graded would otherwise land a denominator of zero, which the check rejects.
	 * Prefer the live problem points, fall back to what somebody was graded out
	 * of, and floor at 1 so the row is always insertable.
	 */
	greatest(
		coalesce((select sum(p.points) from problem p
		          where p.assignment_id = a.id and p.included), 0),
		coalesce((select max(s.max_score) from submission s
		          where s.assignment_id = a.id and s.status = 'graded'), 0),
		1
	),
	0
from assignment a
where exists (select 1 from submission s
              where s.assignment_id = a.id and s.status = 'graded' and s.score is not null)
  -- Idempotent: re-running this file must not trip grade_item_assignment_uniq
  -- and abort the migration half-applied.
  and not exists (select 1 from grade_item gi where gi.assignment_id = a.id);

insert into grade (org_id, grade_item_id, student_id, points_earned, source, submission_id)
select s.org_id, gi.id, s.student_id,
	case when coalesce(s.max_score, 0) > 0
	     then round((s.score / s.max_score) * gi.points_possible, 2)
	     else 0 end,
	'auto', s.id
from (
	-- submission_one_open only constrains in_progress, so a student can hold
	-- several graded attempts. The latest one is the grade.
	select distinct on (assignment_id, student_id) *
	from submission
	where status = 'graded' and score is not null
	order by assignment_id, student_id, graded_at desc nulls last
) s
join grade_item gi on gi.assignment_id = s.assignment_id
-- Idempotent for the same reason, and it means a re-run never walks over a mark
-- a teacher has since corrected.
where not exists (
	select 1 from grade g
	where g.grade_item_id = gi.id and g.student_id = s.student_id
);
