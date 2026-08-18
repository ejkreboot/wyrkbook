-- wyrkbook: initial schema
-- Flat by design. Organization -> {profile, class}; class -> {assignment, weekly_goal};
-- assignment -> problem; student work -> submission -> {submission_page, problem_result, hint_request}.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- organization

create table organization (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- profile

create table profile (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid references organization(id) on delete cascade,
  role          text not null check (role in ('sysadmin','admin','student')),
  display_name  text not null,
  email         text not null,
  created_at    timestamptz not null default now()
);
create index profile_org_idx on profile(org_id);

-- A sysadmin has no org; everyone else must have one.
alter table profile add constraint profile_org_required
  check ((role = 'sysadmin' and org_id is null) or (role <> 'sysadmin' and org_id is not null));

-- ---------------------------------------------------------------- class

create table class (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organization(id) on delete cascade,
  name        text not null,
  subject     text,
  color       text not null default 'slate',
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index class_org_idx on class(org_id);

-- ---------------------------------------------------------------- assignment

create table assignment (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organization(id) on delete cascade,
  class_id      uuid not null references class(id) on delete cascade,
  title         text not null,
  instructions  text,
  week_start    date,                      -- Monday of the target week
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  answer_key    text,                      -- optional teacher-supplied key (free text)
  hint_penalty  numeric not null default 5,-- percentage points deducted per hint
  work_pages    int not null default 4,    -- blank lined pages to print after the problems
  created_by    uuid references profile(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index assignment_class_idx on assignment(class_id);
create index assignment_week_idx  on assignment(org_id, week_start);

-- ---------------------------------------------------------------- weekly_goal

create table weekly_goal (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  class_id       uuid not null references class(id) on delete cascade,
  week_start     date not null,            -- always a Monday
  title          text not null,
  detail         text,
  assignment_id  uuid references assignment(id) on delete set null,
  done           boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index weekly_goal_week_idx  on weekly_goal(org_id, week_start);
create index weekly_goal_class_idx on weekly_goal(class_id, week_start);

-- ---------------------------------------------------------------- problem

create table problem (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  assignment_id  uuid not null references assignment(id) on delete cascade,
  label          text not null,            -- as printed in the book: "12", "3-4"
  body           text not null,
  answer         text,
  points         numeric not null default 1,
  included       boolean not null default true,  -- teacher can drop extraneous problems
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index problem_assignment_idx on problem(assignment_id, sort_order);

-- ---------------------------------------------------------------- submission

create table submission (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  assignment_id  uuid not null references assignment(id) on delete cascade,
  student_id     uuid not null references profile(id) on delete cascade,
  status         text not null default 'in_progress'
                 check (status in ('in_progress','submitted','graded')),
  score          numeric,
  max_score      numeric,
  hint_penalty_total numeric not null default 0,
  feedback       text,
  submitted_at   timestamptz,
  graded_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index submission_student_idx    on submission(student_id, status);
create index submission_assignment_idx on submission(assignment_id);
-- one open attempt per student per assignment
create unique index submission_one_open on submission(assignment_id, student_id)
  where status = 'in_progress';

-- ---------------------------------------------------------------- submission_page

create table submission_page (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  submission_id  uuid not null references submission(id) on delete cascade,
  storage_path   text not null,
  page_number    int not null default 1,
  created_at     timestamptz not null default now()
);
create index submission_page_sub_idx on submission_page(submission_id, page_number);

-- ---------------------------------------------------------------- problem_result

create table problem_result (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  submission_id  uuid not null references submission(id) on delete cascade,
  problem_id     uuid not null references problem(id) on delete cascade,
  student_work   text,                     -- transcribed by the API
  correct        boolean,
  points_earned  numeric not null default 0,
  feedback       text,
  created_at     timestamptz not null default now(),
  unique (submission_id, problem_id)
);
create index problem_result_sub_idx on problem_result(submission_id);

-- ---------------------------------------------------------------- hint_request

create table hint_request (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organization(id) on delete cascade,
  submission_id  uuid not null references submission(id) on delete cascade,
  problem_id     uuid references problem(id) on delete set null,
  student_id     uuid not null references profile(id) on delete cascade,
  storage_path   text,                     -- photo of their work, if supplied
  question       text,
  hint           text not null,
  penalty        numeric not null default 0,
  created_at     timestamptz not null default now()
);
create index hint_request_sub_idx on hint_request(submission_id);
