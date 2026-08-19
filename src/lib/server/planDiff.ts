import type { WeeklyGoal } from '$lib/types';

export type PlanWeek = { week_start: string; lines: string[] };

export type PlanDiff = {
	toInsert: Record<string, unknown>[];
	toUpsert: Record<string, unknown>[];
	toDelete: string[];
};

/**
 * Reconciles the planner's free-text boxes against the goals already stored.
 *
 * The whole point is to be non-destructive: a goal whose title is unchanged keeps
 * its row, and therefore keeps its `done` tick, its `detail`, and any linked
 * assignment. Only genuinely new lines are inserted and genuinely removed lines
 * are deleted. Matching is by exact title within the week, consumed in order so
 * that two identical titles in one week behave sensibly.
 */
export function planDiff(
	incoming: PlanWeek[],
	existing: WeeklyGoal[],
	ctx: { orgId: string; classId: string }
): PlanDiff {
	const byWeek = new Map<string, WeeklyGoal[]>();
	for (const g of existing) {
		if (!byWeek.has(g.week_start)) byWeek.set(g.week_start, []);
		byWeek.get(g.week_start)!.push(g);
	}

	const toInsert: Record<string, unknown>[] = [];
	const toUpsert: Record<string, unknown>[] = [];
	const toDelete: string[] = [];

	for (const week of incoming) {
		const pool = [...(byWeek.get(week.week_start) ?? [])];
		const lines = week.lines.map((l) => l.trim()).filter(Boolean);

		lines.forEach((title, i) => {
			const hit = pool.findIndex((g) => g.title === title);
			if (hit >= 0) {
				const [g] = pool.splice(hit, 1);
				// Untouched apart from position: only write when the order moved.
				if (g.sort_order !== i) toUpsert.push({ ...g, sort_order: i });
			} else {
				toInsert.push({
					org_id: ctx.orgId,
					class_id: ctx.classId,
					week_start: week.week_start,
					title,
					sort_order: i
				});
			}
		});

		// Anything still in the pool was deleted from the box.
		toDelete.push(...pool.map((g) => g.id));
	}

	return { toInsert, toUpsert, toDelete };
}

export function describeDiff(d: PlanDiff): string {
	const parts = [
		d.toInsert.length ? `${d.toInsert.length} added` : '',
		d.toDelete.length ? `${d.toDelete.length} removed` : '',
		d.toUpsert.length ? `${d.toUpsert.length} reordered` : ''
	].filter(Boolean);
	return parts.length ? `Saved — ${parts.join(', ')}.` : 'No changes to save.';
}
