-- wyrkbook: curriculum resources
--
-- A home for the material a teacher lectures from: notes, outlines, worked
-- examples. One row is one document, written in Markdown with KaTeX math, and
-- belongs to a class. `week_start` is optional — some notes belong to a week of
-- the plan, others (a unit overview, a formula sheet) belong to no week at all.
--
-- Teacher notes live inside `body` as `{{double brace}}` spans rather than in a column
-- of their own. They are interleaved with the lecture — "pause here and ask why"
-- sits between two paragraphs — so splitting them out would lose where they go.
-- The consequence is that the whole body is teacher-only: this table has no
-- student policy, and if resources are ever shown to students the notes must be
-- stripped server-side (renderMarkdown with notes: false) before they leave.

create table curriculum_resource (
	id          uuid primary key default gen_random_uuid(),
	org_id      uuid not null references organization(id) on delete cascade,
	class_id    uuid not null references class(id) on delete cascade,
	title       text not null,
	body        text not null default '',
	week_start  date,                       -- Monday of the week it is taught, if any
	created_by  uuid references profile(id) on delete set null,
	created_at  timestamptz not null default now(),
	updated_at  timestamptz not null default now()
);

create index curriculum_resource_class_idx on curriculum_resource(class_id, week_start);
create index curriculum_resource_org_idx   on curriculum_resource(org_id);

alter table curriculum_resource enable row level security;

-- Teachers only, inside their own organization. The absence of a student
-- policy is the protection for the teacher notes embedded in `body`.
create policy curriculum_resource_admin_all on curriculum_resource
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

grant select, insert, update, delete on curriculum_resource to authenticated;
revoke all on curriculum_resource from anon;
