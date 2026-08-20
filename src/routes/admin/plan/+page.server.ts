import { fail } from '@sveltejs/kit';
import { addWeeks, weekStart, weeksBetween } from '$lib/week';
import type { Actions, PageServerLoad } from './$types';
import type { PlanImport, WeeklyGoal } from '$lib/types';
import { describeDiff, planDiff, type PlanWeek } from '$lib/server/planDiff';
import { settleIfExpired } from '$lib/server/planImport';

const MAX_WEEKS = 52;
const DEFAULT_WEEKS = 18;

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	const { classes } = await parent();

	const classId = url.searchParams.get('class') || classes[0]?.id || '';
	const start = url.searchParams.get('start') || weekStart();

	/*
	 * With no explicit ?weeks=, open wide enough to show the whole existing plan.
	 * Otherwise arriving at a class that is already planned out to June would
	 * silently show only the first 18 weeks and look like the rest was lost.
	 */
	const requested = Number(url.searchParams.get('weeks'));
	let count = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_WEEKS;

	if (!(Number.isFinite(requested) && requested > 0) && classId) {
		const { data: furthest } = await locals.supabase
			.from('weekly_goal')
			.select('week_start')
			.eq('class_id', classId)
			.gte('week_start', start)
			.order('week_start', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (furthest?.week_start) {
			// +1 because the furthest week itself has to be visible, +2 for room to grow.
			count = Math.max(count, weeksBetween(start, furthest.week_start) + 1 + 2);
		}
	}

	count = Math.min(Math.max(count, 1), MAX_WEEKS);

	const weeks = Array.from({ length: count }, (_, i) => addWeeks(start, i));

	let goals: WeeklyGoal[] = [];
	if (classId) {
		const { data } = await locals.supabase
			.from('weekly_goal')
			.select('*')
			.eq('class_id', classId)
			.gte('week_start', weeks[0])
			.lte('week_start', weeks[weeks.length - 1])
			.order('week_start')
			.order('sort_order');
		goals = (data ?? []) as WeeklyGoal[];
	}

	/*
	 * A file read outlives the page that started it, so the planner picks up the
	 * class's most recent one rather than assuming the teacher is still sitting
	 * on the tab that kicked it off.
	 *
	 * Deliberately not filtered by status. An `applied` row is finished business
	 * as far as the plan goes, but it still carries the guidance that produced
	 * it — which is the thing worth having back when the pacing came out wrong
	 * and the teacher wants to say it differently and read the file again.
	 */
	let pending: PlanImport | null = null;
	if (classId) {
		const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const { data } = await locals.supabase
			.from('plan_import')
			.select('*')
			.eq('class_id', classId)
			.gte('created_at', monthAgo)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (data) pending = await settleIfExpired(data as PlanImport, locals.supabase);
	}

	// A stale red box helps nobody: an old failure supplies its guidance but not
	// its error. A `running` row needs no age check — its own `expires_at` has
	// already settled it above if the function that owned it is gone.
	const staleFailure =
		pending?.status === 'failed' &&
		Date.now() - new Date(pending.created_at).getTime() > 24 * 60 * 60 * 1000;

	return {
		classId,
		start,
		count,
		weeks,
		goals,
		currentWeek: weekStart(),
		pendingImport: pending && {
			id: pending.id,
			status: pending.status,
			file_name: pending.file_name,
			guidance: pending.guidance ?? '',
			notes: pending.notes ?? '',
			weeks: pending.plan ?? [],
			error: staleFailure ? '' : (pending.error ?? '')
		}
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		if (!classId) return fail(400, { message: 'Choose a class first.' });

		let incoming: PlanWeek[] = [];
		try {
			incoming = JSON.parse(String(form.get('weeks') ?? '[]'));
		} catch {
			return fail(400, { message: 'The plan could not be read.' });
		}
		if (!incoming.length) return fail(400, { message: 'Nothing to save.' });

		const orgId = locals.profile!.org_id;
		const weekList = incoming.map((w) => w.week_start).sort();

		const { data: existingRows } = await locals.supabase
			.from('weekly_goal')
			.select('*')
			.eq('class_id', classId)
			.gte('week_start', weekList[0])
			.lte('week_start', weekList[weekList.length - 1]);

		const { toInsert, toUpsert, toDelete } = planDiff(
			incoming,
			(existingRows ?? []) as WeeklyGoal[],
			{ orgId: orgId!, classId }
		);

		if (toDelete.length) {
			const { error } = await locals.supabase.from('weekly_goal').delete().in('id', toDelete);
			if (error) return fail(400, { message: error.message });
		}
		if (toUpsert.length) {
			const { error } = await locals.supabase.from('weekly_goal').upsert(toUpsert);
			if (error) return fail(400, { message: error.message });
		}
		if (toInsert.length) {
			const { error } = await locals.supabase.from('weekly_goal').insert(toInsert);
			if (error) return fail(400, { message: error.message });
		}

		return { message: describeDiff({ toInsert, toUpsert, toDelete }) };
	}
};
