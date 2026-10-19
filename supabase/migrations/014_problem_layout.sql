-- wyrkbook: directions and work space, problem by problem
--
-- An assignment used to print as one run of problems followed by blank ruled
-- pages, the student writing each problem's number in the margin beside its
-- work. Now each problem is followed by room to work it, so the work sits
-- under the problem it belongs to and the sheet is the whole assignment.
--
-- `directions` is the instruction line a run of problems shares, as the book
-- prints it ("Solve for x.", "Simplify each expression."). It prints once above
-- the first problem of the run, like `section` (013). Extraction fills it; the
-- assignment's own `instructions` stay for anything that covers the whole set.
--
-- `work_lines` is how much room to leave below the problem, in lines of about
-- 8mm, sized by the AI from what working it takes and changeable by the
-- teacher. Null for problems from before this (they print with a default) and
-- for any not yet sized. 0 is no room: a problem answered in a word.
--
-- `assignment.work_pages` stays: extra ruled pages, now 0 by default, for
-- overflow. Work on them is still numbered in the margin.
--
-- Same visibility as the rest of the row (002_rls.sql).

alter table problem add column directions text;
alter table problem add column work_lines int check (work_lines between 0 and 30);

alter table assignment alter column work_pages set default 0;
