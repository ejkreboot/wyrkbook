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
| `student` | Work *published* assignments in the classes they are enrolled in, see those classes' weekly goals, ask for hints, turn in work, read their own results. |

### Rosters

A class has a roster, and it is what a student's whole view is cut from: the
weekly goals they see and the assignments they can pick up are the ones
belonging to a class they are on. A student on no roster sees nothing.

Enrollment is edited from both ends and the two are the same rows — one class
and its students on `/admin/classes`, one student and their classes on
`/admin/students`.

The roster governs what a student can *start*, not what they can finish.
`wb_can_work()` also passes an assignment the student already has a submission
against, so unenrolling somebody mid-assignment does not make the sheet in their
hands, its problems and their own in-progress work vanish from under them.

Teachers get the roster back as a filter: pick a student on **This week** or the
calendar and the board narrows to their classes, showing the week as that one
student sees it.

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
      documents.ts            PDF/text/photo uploads as content blocks
      planImport.ts           the term-import prompt and its output hardening
      deferred.ts             work that outlives the response that started it
      supabaseAdmin.ts        service-role client
      users.ts                auth user + profile provisioning
      goals.ts                weekly-goal actions, shared by two routes
      enrollment.ts           roster actions, shared by two routes
  routes/
    login/                    two-step email OTP
    sysadmin/                 organizations and admins
    admin/                    this week, calendar, classes, students, assignments
    student/                  available work, work session, results
    s/[id]/                   QR target — opens or resumes a work session
    api/{extract,hint,grade,plan-import}/
                              the Anthropic calls
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

Save plan is greyed out until the boxes differ from what the server sent, with
an "Unsaved changes" mark beside it once they do. The comparison
(`src/lib/planFingerprint.ts`) normalizes the boxes exactly the way `planDiff`
does — trim, drop blank lines, ignore an empty week — because the two have to
agree in both directions: a false "unchanged" hides an edit behind a dead
button, and a false "changed" nags about whitespace nobody typed.

Run `npm run test:plan` for the reconciliation tests, including the case that
motivates the whole design (editing one line in a week where another goal is
already ticked off) and the property that keeps the button honest: the
fingerprint calls a plan clean exactly when planDiff would write nothing.

Known limit: moving a goal from one week to another is a delete plus an insert,
so a completed goal that moves weeks comes back unticked.

### Starting from the publisher's file

Typing forty weeks of a science course out of a PDF is the worst hour of the
school year, so **Start from a file** on the planner does it: upload the lesson
list, syllabus or schedule, say what the file cannot know, and the boxes fill in.

The guidance box is the whole interface. A publisher's lesson list is a daily
plan for an unspecified number of weeks with no holidays in it; only the teacher
knows the term is forty weeks long, that the quizzes in the right-hand column
belong with the chapter they follow, and that nothing happens the week of
Christmas. That goes in the box, in prose.

Two things keep it honest:

- **Weeks are numbered, not dated.** The model returns `{week: 12, goals: [...]}`
  and `planImport.ts` maps the number onto a Monday. It is shown the calendar so
  "take Thanksgiving off" lands in the right box, but it never does date
  arithmetic, and a week number outside the range is dropped rather than
  written somewhere surprising.
- **Nothing is saved.** A read fills the text boxes and stops. The teacher edits
  them and presses Save plan, which goes through the same reconciliation as any
  other edit — so re-importing over a term already underway does not silently
  wipe the `done` ticks on work that matched. A proposed plan lives in
  `plan_import` as jsonb precisely so that it is not a set of goals yet.

#### The read is a job, not a request

Reading the Novare *Physical Science* lesson list and pacing it over a school
year takes about ninety seconds. That is a fine trade against the hour it takes
by hand, but far too long to hold a request open and watch a spinner. So the
upload starts a job and returns:

```
POST /api/plan-import       insert a plan_import row, defer the model call,
                            return { id } in about a second
GET  /api/plan-import/<id>  a cheap row read, polled every 3s
POST /api/plan-import/<id>  mark it applied once its plan is in the boxes
```

The deferred half runs under `waitUntil` from `@vercel/functions`, which extends
the function invocation past the response it already sent. The teacher can close
the tab; the planner picks the job back up on the next visit, because what is in
flight lives in the row rather than in the page. A read that finishes while they
are elsewhere is *offered* rather than applied, since the boxes may hold edits
they have not saved.

The planner reads back the class's most recent import whatever its status, not
just an unfinished one, because a finished row still carries the guidance that
produced it. Getting the pacing right is a conversation — "actually make it 36
weeks", "move the break a week later" — and the second turn should start from
the sentence that was wrong, not from an empty box. The box follows the stored
guidance only while it is untouched; once edited it survives reloads, including
the one that follows a save. The document itself is not kept, so re-running
means picking the file again — its name is shown to say which.

Two failure modes are handled without a queue or a cron:

- **The function is killed.** `waitUntil` promises die with their invocation, so
  a row could sit at `running` forever with nobody left to write to it. The row
  stores `expires_at`, taken from `getDeadline()` — the exact instant Vercel will
  terminate the invocation — and any read of a `running` row past that settles it
  as failed. That is the whole recovery mechanism.
- **The poll drops.** A failed poll is retried, not treated as a failed job. The
  job is on the server; the browser is only watching.

Off-platform — `vite dev` — there is no invocation to extend and `waitUntil` does
nothing, so `deferred.ts` lets the promise run loose instead. The dev server is a
long-lived process, so it behaves the same.

The `maxDuration: 300` on the upload route covers the deferred work too:
`waitUntil` time counts against it like any other. Uploads are capped at 4 MB —
not an Anthropic limit (theirs is 32 MB) but a Vercel one, whose 4.5 MB request
body ceiling is enforced at the edge, where a friendlier message cannot reach.

#### Which model

Measured on the Novare lesson list, same guidance, all three complete and
correct — every quiz, every lab, and the break weeks in the right places:

| | wall clock | output tokens | cost |
| --- | --- | --- | --- |
| Opus 5 | 87s | 9,633 | $0.30 |
| Sonnet 5 | 117s | 16,040 | $0.28 |
| Haiku 4.5 | 117s | 19,902 | $0.11 |

There is no cheaper-and-faster option: output tokens dominate both latency and
cost, and Opus is simply terser — it writes `Section 8.4: Unit Conversions;
math principles (p. 149)` where the others emit a line per source row. Opus 5 is
both the fastest and, against Sonnet's standard rates, about the same price.

`npm run test:import -- <file> "<guidance>"` runs a real document through the
same prompt and prints the plan to the terminal, which is the only way to tell
whether it can actually read a two-column lesson list. It costs an API call and
touches no database. `MODEL=claude-haiku-4-5 npm run test:import -- …` runs it
past a different model.

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
