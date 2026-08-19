-- wyrkbook: term imports read from a file
--
-- Reading a publisher's lesson list and pacing it over a school year takes the
-- model about ninety seconds. That is fine for the task — a person doing it by
-- hand loses an hour — but it is far too long to hold an HTTP request open and
-- watch a spinner.
--
-- So the read becomes a job. The upload returns in about a second with a row
-- id; the work continues in the same function under `waitUntil` and writes its
-- result here; the planner polls. The teacher can close the tab and come back,
-- and the finished plan is waiting on the page.
--
-- Nothing here is applied automatically. A `ready` row holds a proposed plan
-- that the teacher still has to look at and save, which is why the plan lives
-- in this table as jsonb rather than being written straight into weekly_goal.

create table plan_import (
	id          uuid primary key default gen_random_uuid(),
	org_id      uuid not null references organization(id) on delete cascade,
	class_id    uuid not null references class(id) on delete cascade,
	created_by  uuid references profile(id) on delete set null,

	file_name   text not null,
	guidance    text,
	week_start  date not null,              -- the Monday the plan is laid out from

	status      text not null default 'running'
	              check (status in ('running','ready','failed','applied')),

	/*
	 * The instant Vercel will kill the invocation, from getDeadline(). A row
	 * still 'running' past this is dead — the promise was cancelled with it —
	 * and the poll endpoint reports it as failed. This is the whole
	 * crash-recovery mechanism: no queue, no cron, no reaper process.
	 */
	expires_at  timestamptz not null,

	notes       text,                       -- the model's account of how it paced things
	plan        jsonb,                      -- [{ week_start, lines: [...] }]
	error       text,

	created_at  timestamptz not null default now(),
	finished_at timestamptz
);

create index plan_import_class_idx on plan_import(class_id, created_at desc);
create index plan_import_org_idx   on plan_import(org_id);

alter table plan_import enable row level security;

-- Teachers only, inside their own organization. Students have no policy at all,
-- which is the protection — a plan_import row carries a whole term's material.
-- The background worker writes its result through the service role, since by
-- then there is no request and no user session left to act as.
create policy plan_import_admin_all on plan_import
	for all to authenticated
	using      (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()))
	with check (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));

grant select, insert, update, delete on plan_import to authenticated;
revoke all on plan_import from anon;
