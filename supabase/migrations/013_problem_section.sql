-- wyrkbook: the heading a problem is printed under
--
-- An exercise set is rarely one run of problems. A lesson's practice is usually
-- followed by a "Mixed Review" or "Spiral Review" block, and those review
-- problems are the ones the trimmer (/api/trim) must leave alone — it is told
-- which they are by this heading, read off the page at extraction. It also
-- prints above the first problem of each group, as the book has it.
--
-- Free text, nullable: older problems, hand-typed problems and books without
-- headings have none. Same visibility as the rest of the row (002_rls.sql).

alter table problem add column section text;
