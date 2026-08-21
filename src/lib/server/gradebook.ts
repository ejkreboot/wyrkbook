import type { SupabaseClient } from '@supabase/supabase-js';
import type { GradeItem } from '$lib/types';

/**
 * Getting a graded submission into the gradebook.
 *
 * Two callers, and the difference between them is who is deciding. /api/grade
 * calls recordAutoGrade() as the machine, which must never overwrite a mark a
 * teacher has set. /admin/submissions/[id] calls recordTeacherGrade() as the
 * teacher, which overwrites anything and claims the cell as manual from then on
 * — they have looked at the paper, and that outranks a re-run of the grader.
 *
 * Neither is handed a score. Both write submission.score first and pass the id,
 * so the mark is read back from what was actually stored: the scoring formula
 * lives in two places, but the gradebook only ever sees one answer.
 */

/** Postgres unique_violation — the row we tried to insert is already there. */
const UNIQUE_VIOLATION = '23505';

type SyncResult = { error: string | null };

type EmbeddedAssignment = { id: string; class_id: string; org_id: string; title: string };

/**
 * The class's column for this assignment, made if it is not there yet.
 */
async function itemForAssignment(
	db: SupabaseClient,
	assignment: EmbeddedAssignment
): Promise<{ item: GradeItem | null; error: string | null }> {
	const { data: found } = await db
		.from('grade_item')
		.select('*')
		.eq('assignment_id', assignment.id)
		.maybeSingle(); // safe: grade_item_assignment_uniq

	if (found) {
		/*
		 * An assignment can be moved to another class from its editor, and there
		 * is no trigger to follow it. Repair the column here rather than leaving
		 * it hanging off a roster it no longer belongs to.
		 */
		if (found.class_id !== assignment.class_id) {
			await db.from('grade_item').update({ class_id: assignment.class_id }).eq('id', found.id);
			found.class_id = assignment.class_id;
		}
		return { item: found as GradeItem, error: null };
	}

	/*
	 * The denominator is a snapshot of the problems the teacher kept, taken once.
	 * After this the column stands on its own and later submissions are rescaled
	 * onto it — see the doc comment on GradeItem.
	 */
	const { data: problems } = await db
		.from('problem')
		.select('points')
		.eq('assignment_id', assignment.id)
		.eq('included', true);

	const possible = (problems ?? []).reduce((n, p) => n + Number(p.points ?? 1), 0);

	const { data: last } = await db
		.from('grade_item')
		.select('sort_order')
		.eq('class_id', assignment.class_id)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { data: created, error } = await db
		.from('grade_item')
		.insert({
			org_id: assignment.org_id,
			class_id: assignment.class_id,
			assignment_id: assignment.id,
			title: assignment.title,
			points_possible: possible > 0 ? possible : 10,
			sort_order: (last?.sort_order ?? -1) + 1
		})
		.select('*')
		.single();

	if (error) {
		// Two students turning in at once both try to open the column. The unique
		// index decides; the loser reads back what the winner made.
		if (error.code === UNIQUE_VIOLATION) {
			const { data: raced } = await db
				.from('grade_item')
				.select('*')
				.eq('assignment_id', assignment.id)
				.maybeSingle();
			return { item: (raced as GradeItem) ?? null, error: raced ? null : error.message };
		}
		return { item: null, error: error.message };
	}

	return { item: created as GradeItem, error: null };
}

async function write(
	db: SupabaseClient,
	submissionId: string,
	source: 'auto' | 'manual'
): Promise<SyncResult> {
	const { data: sub } = await db
		.from('submission')
		.select(
			'id, org_id, student_id, status, score, max_score, assignment(id, class_id, org_id, title)'
		)
		.eq('id', submissionId)
		.maybeSingle();

	// Nothing to mirror until it is actually graded.
	if (!sub || sub.status !== 'graded' || sub.score === null) return { error: null };

	const assignment = sub.assignment as unknown as EmbeddedAssignment | null;
	if (!assignment) return { error: null };

	const { item, error: itemError } = await itemForAssignment(db, assignment);
	if (!item) return { error: itemError };

	/*
	 * Rescale onto the column's denominator. A submission graded out of eight
	 * problems and one graded out of ten are not comparable raw, and a column
	 * that mixes them is worse than no column at all.
	 */
	const max = Number(sub.max_score ?? 0);
	const points =
		max > 0 ? Math.round((Number(sub.score) / max) * Number(item.points_possible) * 100) / 100 : 0;

	const patch = {
		points_earned: points,
		source,
		submission_id: submissionId,
		updated_at: new Date().toISOString()
	};

	/*
	 * PostgREST's upsert cannot express `on conflict ... do update ... where`, so
	 * the guard goes in an UPDATE's WHERE clause and the unique index settles the
	 * rest. Three cases, each a single statement and all correct:
	 *
	 *   no row       -> the update touches nothing, the insert succeeds
	 *   an auto row  -> the update replaces it, the insert never runs
	 *   a manual row -> the update skips it (.neq), the insert hits 23505, ignored
	 *
	 * Read-then-write would race with a teacher saving the grid at the same
	 * moment. A SQL function would also work and would be one round trip, but
	 * this schema has no functions outside the RLS helpers and no triggers at
	 * all — the logic belongs where the rest of the app's logic is, and the
	 * constraint is already doing the arbitration. Same instinct as
	 * enrollment.ts leaning on `ignoreDuplicates` rather than checking first.
	 */
	let update = db
		.from('grade')
		.update(patch)
		.eq('grade_item_id', item.id)
		.eq('student_id', sub.student_id);

	if (source === 'auto') update = update.neq('source', 'manual');

	const { data: updated, error: updateError } = await update.select('id');
	if (updateError) return { error: updateError.message };
	if (updated?.length) return { error: null };

	const { error } = await db.from('grade').insert({
		org_id: sub.org_id,
		grade_item_id: item.id,
		student_id: sub.student_id,
		...patch
	});

	// 23505 here means the manual row the update deliberately skipped. Leave it.
	if (error && error.code !== UNIQUE_VIOLATION) return { error: error.message };
	return { error: null };
}

/** The grader speaking. Never overwrites a mark a teacher set. */
export const recordAutoGrade = (db: SupabaseClient, submissionId: string) =>
	write(db, submissionId, 'auto');

/** The teacher speaking, from the submission page. Wins, and claims the cell. */
export const recordTeacherGrade = (db: SupabaseClient, submissionId: string) =>
	write(db, submissionId, 'manual');
