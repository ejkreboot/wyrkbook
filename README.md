# wyrkbook

A school management system for a homeschool. Weeks are the unit of measure, and
paper stays in the loop — the app prints assignments, and the phone camera reads
the work back in.

## Two features

**Class calendar.** Weekly goal sets are first-class rows, not a view over
assignments. A goal belongs to a class and a week (`week_start`, always a
Monday), so the same data slices per-class, per-week, or per-month without any
reshaping. A goal can optionally point at an assignment.

**Assignment management.** A teacher photographs an exercise set; the Anthropic
API transcribes it into individual problems; the teacher edits and drops the
extraneous ones before printing. The printed sheet carries the problems on the
first page(s), a QR code, and a run of blank ruled pages with a left margin
where the student writes the problem number they're working on. The student
scans the QR to open a session, can photograph their work for a hint (at a
score penalty), and photographs the finished pages to be graded.

## Setup

1. **Environment.** Copy `.env.example` to `.env` and fill it in. The Supabase
   values are already set for the `wyrkbook` project; `ANTHROPIC_API_KEY` is the
   one you need to add.

2. **Database.** The migrations in `supabase/migrations/` are already applied to
   the hosted project. To re-apply from scratch:

   ```sh
   supabase link --project-ref bpncxbhqkoybtrpvjety
   supabase db push
   ```

3. **First account.** Every other user is created from inside the app, but the
   first sysadmin has nobody to create it:

   ```sh
   npm run seed:sysadmin -- you@example.com "Your Name"
   ```

4. **Run it.**

   ```sh
   npm run dev
   ```

## Roles

Enforced by Postgres RLS, not by the UI.

| Role | Can |
| --- | --- |
| `sysadmin` | Create organizations and admins. No org of their own. |
| `admin` | Everything inside their organization: classes, goals, assignments, students, grades. |
| `student` | Work any *published* assignment in their org, ask for hints, turn in work, read their own results. |

There is deliberately no roster: students are not assigned to classes, and any
student can pick up any published assignment.

Two things are written with the service role rather than the user's own client,
because RLS gives students no way to do them: minting auth users, and writing
hint text and grades. A student can read their hints and results but cannot
forge either.

## Layout

```
src/
  app.css                     the entire stylesheet, including @media print
  hooks.server.ts             Supabase SSR client + role guard
  lib/
    week.ts                   Monday normalization, week/month labels
    types.ts                  row types
    server/
      anthropic.ts            lazy API client
      vision.ts               upload validation, base64, JSON recovery
      supabaseAdmin.ts        service-role client
      users.ts                auth user + profile provisioning
      goals.ts                weekly-goal actions, shared by two routes
  routes/
    login/                    two-step email OTP
    sysadmin/                 organizations and admins
    admin/                    this week, calendar, classes, students, assignments
    student/                  available work, work session, results
    s/[id]/                   QR target — opens or resumes a work session
    api/{extract,hint,grade}/ the three Anthropic calls
supabase/migrations/          schema, RLS, storage buckets
scripts/seed-sysadmin.ts      one-time bootstrap
```

## Printing

`/admin/assignments/<id>/print` is a normal page whose screen chrome is hidden
by the print stylesheet. Page size is US Letter. Ruled work pages are generated
with a repeating CSS gradient at 8.4mm spacing, with a red left margin rule at
20mm — that margin is what the grader reads to attribute work to a problem.
The number of work pages is per-assignment (`work_pages`).

## Planning a term

`/admin/plan` is the bulk entry point for weekly goals: pick a class, a starting
week and a length, and you get one text box per week with one goal per line.
Paste a column straight out of a spreadsheet and it lands as one goal per row.

Saving reconciles the boxes against what is stored rather than replacing it.
This matters: a naive "delete the week and re-insert" would clear every `done`
tick each time the planner was touched. `src/lib/server/planDiff.ts` matches
lines to existing goals by title within the week, so an untouched line keeps its
row — and therefore its completion state, its detail, and any linked assignment.
Only genuinely new lines are inserted and genuinely deleted lines removed.

Run `npm run test:plan` for the reconciliation tests, including the case that
motivates the whole design: editing one line in a week where another goal is
already ticked off.

Known limit: moving a goal from one week to another is a delete plus an insert,
so a completed goal that moves weeks comes back unticked.

## Security model

Audited against the live database with rolled-back transactions that impersonate
a student (`set local role authenticated` + a forged `request.jwt.claims`), not
by reading the policies and hoping. Migration `004_harden_rls.sql` closes four
real holes the first pass left open:

- **Answers were readable by students.** RLS is row-level, and PostgREST lets a
  client select any column of a row it can see — so `?select=answer` returned
  every answer for any published assignment. Column-level `GRANT`s cannot fix
  this, because admins and students are both the `authenticated` role. Answers
  now live in `problem_answer` / `assignment_key`, which have an admin-only
  policy and no student policy at all. Grading reads them through the service
  role inside the API handler; they never reach a student's client.
- **Students could grade themselves.** The old `submission_student_update`
  policy allowed `score = 100, status = 'graded', hint_penalty_total = 0`. Every
  post-creation write to a submission is server-side, so students now have no
  UPDATE policy.
- **Students could start work on unpublished drafts.** The INSERT policy now
  requires the assignment to be `published` and in their org.
- **Students could enumerate every profile in the org**, including teacher
  emails. Profile reads are admin-only plus your own row.

`anon` has been stripped of all access — nothing here is public, and sign-in
goes through GoTrue rather than PostgREST.

Session isolation: no user data is held in module scope, no route sets a cache
header, and `+layout.server.ts` deliberately does **not** return `cookies`. The
usual `@supabase/ssr` SvelteKit recipe passes `cookies.getAll()` to a universal
load, which serializes the auth token into the SSR HTML payload; nothing in this
app talks to Supabase from the browser, so that client was removed entirely and
the token stays server-side.
