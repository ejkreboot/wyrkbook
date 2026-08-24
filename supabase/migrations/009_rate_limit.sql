-- wyrkbook: rate limiting for the unauthenticated door
--
-- Everything on /login can be called by anyone who can reach the site, and three
-- of those actions are worth hammering: guessing a password, guessing a reset
-- PIN, and asking /login/mode whether a username exists. Attempt burning already
-- protects a single PIN (migration 008); this protects everything else, and it
-- protects it across accounts, which per-account counters cannot do.
--
-- In the database rather than in the process, because the app runs as serverless
-- functions: an in-memory counter would be per-instance and would reset whenever
-- one went cold, which is to say it would count roughly nothing.

create table rate_limit (
	/*
	 * `scope:hash`. The identifier half is hashed by the caller so that typed-in
	 * addresses — including the wrong ones a stranger tries — do not accumulate
	 * here in the clear. See $lib/server/rateLimit.
	 */
	key           text primary key,
	count         int not null default 0,
	window_start  timestamptz not null default now()
);

create index rate_limit_window_idx on rate_limit(window_start);

alter table rate_limit enable row level security;
-- No policies, and no grants below: this table belongs to the function.

/*
 * Count one hit against `p_key` and say whether it is still under the limit.
 *
 * Fixed window, not a sliding one. A sliding window is fairer at the boundary
 * and costs a row per hit to compute; the failure mode here — someone gets
 * 2× the limit by straddling a boundary — is irrelevant when the limits are set
 * for humans typing passwords.
 *
 * One statement, so two requests arriving together cannot both read the old
 * count and both decide they are fine.
 */
create or replace function wb_rate_limit(p_key text, p_limit int, p_window_seconds int)
	returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
	hits int;
	cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
begin
	insert into rate_limit as r (key, count, window_start)
		values (p_key, 1, now())
	on conflict (key) do update
		set count        = case when r.window_start < cutoff then 1 else r.count + 1 end,
		    window_start = case when r.window_start < cutoff then now() else r.window_start end
	returning r.count into hits;

	/*
	 * Opportunistic sweep, ~1 call in 200, so the table stays the size of recent
	 * traffic without a scheduled job to forget about. A day is far longer than
	 * any window this app uses.
	 */
	if random() < 0.005 then
		delete from rate_limit where window_start < now() - interval '1 day';
	end if;

	return hits <= p_limit;
end $$;

revoke execute on function wb_rate_limit(text, int, int) from public, anon, authenticated;
grant  execute on function wb_rate_limit(text, int, int) to service_role;
