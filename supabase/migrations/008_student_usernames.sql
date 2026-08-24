-- wyrkbook: students sign in with a username and a password
--
-- The emailed code assumed everyone reads their own inbox. Young students often
-- do not have one, so they get a username and a password instead; teachers keep
-- the emailed code, which is why `profile` now carries both and the login page
-- decides which to ask for based on who the identifier belongs to.
--
-- A student's `email` becomes bookkeeping rather than a way to reach them. GoTrue
-- has no notion of a username, so a student still needs an address to hang an
-- auth user off; the app synthesizes one from the username under a domain that
-- cannot receive mail (STUDENT_EMAIL_DOMAIN, default students.invalid). Nothing
-- is ever sent to it: students never get an OTP and never get a reset link.
--
-- Which is what `password_reset` is for. A forgotten password must not be fixed
-- by mailing the student, and it must not be fixed by the teacher choosing a
-- password either — the teacher would then know it. Instead the student asks for
-- a reset, the app mints a one-time PIN, the teacher reads the PIN off the people
-- page and tells them, and the student trades it for a password of their own.
-- The PIN is the only secret a teacher ever sees, and it buys exactly one reset.

-- ---------------------------------------------------------------- username

alter table profile add column username text;

/*
 * Backfilled from the local part of the address, since existing students were
 * provisioned by email. Looped rather than done as one UPDATE because both
 * failure modes need handling per row: a local part that is too short or all
 * punctuation, and two addresses at different domains sharing one local part.
 */
do $$
declare
	r record;
	base text;
	candidate text;
	n int;
begin
	for r in select id, email from profile where role = 'student' order by created_at loop
		base := regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9._-]', '', 'g');
		if length(base) < 3 then
			base := 'student' || right(replace(r.id::text, '-', ''), 4);
		end if;
		candidate := left(base, 32);
		n := 1;
		while exists (select 1 from profile where username = candidate) loop
			n := n + 1;
			-- Trimmed by the width of the suffix, so a long local part cannot push
			-- the result past the 32 characters profile_username_format allows.
			candidate := left(base, 32 - length(n::text)) || n::text;
		end loop;
		update profile set username = candidate where id = r.id;
	end loop;
end $$;

-- Lowercase and punctuation-limited so it is storable as typed: the login form
-- normalizes before it looks anyone up, and a case-folding index would then be
-- doing work the app has already done.
alter table profile add constraint profile_username_format
	check (username is null or username ~ '^[a-z0-9._-]{3,32}$');

-- Teachers and sysadmins sign in by email and have no username; students have
-- nothing else to sign in with, so theirs is required.
alter table profile add constraint profile_username_role
	check ((role = 'student') = (username is not null));

create unique index profile_username_uniq on profile(username);

-- ---------------------------------------------------------------- password_reset

create table password_reset (
	/*
	 * One live PIN per student, keyed on the student. A second request replaces
	 * the first rather than queueing behind it: two valid PINs for one account is
	 * strictly worse than one, and the teacher reading them off a list would have
	 * no way to know which one the student is holding.
	 */
	student_id  uuid primary key references profile(id) on delete cascade,
	org_id      uuid not null references organization(id) on delete cascade,

	/*
	 * Stored as typed. This is deliberate and is the difference from a password:
	 * the teacher has to be able to read it out loud, it is worth one reset, and
	 * it dies on use or on `expires_at`. Nothing else in the app is stored this
	 * way, and nothing else should be.
	 */
	pin         text not null,

	/*
	 * Six digits is a million guesses in theory and a few thousand in practice
	 * against an unauthenticated endpoint, so the PIN burns after a handful of
	 * wrong tries. Without this the reset form is a slow brute force on any
	 * username someone can guess.
	 */
	attempts    int not null default 0,

	expires_at  timestamptz not null,
	created_at  timestamptz not null default now()
);

create index password_reset_org_idx on password_reset(org_id);

alter table password_reset enable row level security;

/*
 * Read-only, and only for the teacher who has to relay it. Minting and spending
 * a PIN both happen on the service role in $lib/server/passwords — the student
 * doing either is signed out by definition, and an admin has no reason to write
 * this table by hand.
 */
create policy reset_admin_read on password_reset
	for select to authenticated
	using (wb_is_admin() and (org_id = wb_org() or wb_is_sysadmin()));
