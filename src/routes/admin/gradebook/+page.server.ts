import { fail } from '@sveltejs/kit';
import { readCell } from '$lib/gradeGrid';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { classes } = await parent();
	const classId = url.searchParams.get('class') || classes[0]?.id || '';

	if (!classId) return { classId: '', items: [], students: [], grades: [], linkable: [] };

	const [{ data: enrollments }, { data: items }, { data: assignments }] = await Promise.all([
		locals.supabase.from('enrollment').select('student_id').eq('class_id', classId),
		locals.supabase
			.from('grade_item')
			.select('*')
			.eq('class_id', classId)
			.order('sort_order')
			.order('created_at'),
		locals.supabase
			.from('assignment')
			.select('id, title')
			.eq('class_id', classId)
			.neq('status', 'archived')
			.order('week_start', { ascending: false, nullsFirst: false })
	]);

	const itemIds = (items ?? []).map((i) => i.id as string);
	const { data: grades } = itemIds.length
		? await locals.supabase.from('grade').select('*').in('grade_item_id', itemIds)
		: { data: [] };

	/*
	 * The roster says who is in the class now; the grades say who was. A student
	 * unenrolled after a term still holds marks in these columns, and a grid built
	 * from the roster alone would quietly drop them while the rows sat there. Show
	 * both, and flag the ones who have left so the teacher knows why they are here.
	 */
	const rosterIds = new Set((enrollments ?? []).map((e) => e.student_id as string));
	const gradedIds = new Set((grades ?? []).map((g) => g.student_id as string));
	const ids = [...new Set([...rosterIds, ...gradedIds])];

	const { data: people } = ids.length
		? await locals.supabase
				.from('profile')
				.select('id, display_name')
				.in('id', ids)
				.order('display_name')
		: { data: [] };

	// An assignment already carrying a column is not worth offering again.
	const linked = new Set((items ?? []).map((i) => i.assignment_id).filter(Boolean));

	return {
		classId,
		items: items ?? [],
		grades: grades ?? [],
		students: (people ?? []).map((p) => ({ ...p, enrolled: rosterIds.has(p.id as string) })),
		linkable: (assignments ?? []).filter((a) => !linked.has(a.id))
	};
};

/** The largest sort_order in a class, so a new column lands at the end. */
async function nextSortOrder(
	supabase: App.Locals['supabase'],
	classId: string
): Promise<number> {
	const { data } = await supabase
		.from('grade_item')
		.select('sort_order')
		.eq('class_id', classId)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();
	return (data?.sort_order ?? -1) + 1;
}

export const actions: Actions = {
	addItem: async ({ request, locals }) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		const assignmentId = String(form.get('assignment_id') ?? '') || null;
		let title = String(form.get('title') ?? '').trim();
		const points = Number(String(form.get('points_possible') ?? '').trim());

		if (!classId) return fail(400, { message: 'Choose a class first.' });
		if (!Number.isFinite(points) || points <= 0) {
			return fail(400, { message: 'An item has to be worth more than nothing.' });
		}

		/*
		 * Linking to an assignment and leaving the title blank is the common case —
		 * the assignment already has a name and retyping it is busywork.
		 */
		if (assignmentId && !title) {
			const { data: assignment } = await locals.supabase
				.from('assignment')
				.select('title, class_id')
				.eq('id', assignmentId)
				.maybeSingle();
			if (!assignment || assignment.class_id !== classId) {
				return fail(400, { message: 'That assignment is not in this class.' });
			}
			title = assignment.title;
		}

		if (!title) return fail(400, { message: 'An item needs a name.' });

		const { error } = await locals.supabase.from('grade_item').insert({
			org_id: locals.profile!.org_id,
			class_id: classId,
			assignment_id: assignmentId,
			title,
			points_possible: points,
			sort_order: await nextSortOrder(locals.supabase, classId)
		});

		if (error) return fail(400, { message: error.message });
		return { ok: true, message: `Added ${title}.` };
	},

	/** A typo'd name or denominator is otherwise unfixable without losing the marks. */
	updateItem: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const points = Number(String(form.get('points_possible') ?? '').trim());

		if (!id || !title) return fail(400, { message: 'An item needs a name.' });
		if (!Number.isFinite(points) || points <= 0) {
			return fail(400, { message: 'An item has to be worth more than nothing.' });
		}

		const { error } = await locals.supabase
			.from('grade_item')
			.update({ title, points_possible: points })
			.eq('id', id);

		if (error) return fail(400, { message: error.message });
		return { ok: true, message: 'Item updated.' };
	},

	removeItem: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const { error } = await locals.supabase.from('grade_item').delete().eq('id', id);
		if (error) return fail(400, { message: error.message });
		return { ok: true, message: 'Item removed, marks and all.' };
	},

	saveGrades: async ({ request, locals }) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		if (!classId) return fail(400, { message: 'Choose a class first.' });

		let cells: { item_id: string; student_id: string; value: string }[] = [];
		try {
			cells = JSON.parse(String(form.get('cells') ?? '[]'));
		} catch {
			return fail(400, { message: 'The grades could not be read.' });
		}
		if (!cells.length) return fail(400, { message: 'Nothing to save.' });

		/*
		 * RLS keeps this inside the org but has nothing to say about which class an
		 * item belongs to, so a forged item id from a sibling class would go
		 * straight through. Same check enrollment.ts makes about roles, for the
		 * same reason.
		 */
		const { data: mine } = await locals.supabase
			.from('grade_item')
			.select('id')
			.eq('class_id', classId);
		const allowed = new Set((mine ?? []).map((i) => i.id as string));

		const rows = [];
		for (const cell of cells) {
			if (!allowed.has(cell.item_id)) {
				return fail(400, { message: 'That item is not in this class.' });
			}
			const value = readCell(cell.value);
			if (value === 'invalid') {
				return fail(400, { message: `"${cell.value}" is not a number of points.` });
			}
			rows.push({
				org_id: locals.profile!.org_id,
				grade_item_id: cell.item_id,
				student_id: cell.student_id,
				points_earned: value,
				source: 'manual',
				updated_at: new Date().toISOString()
			});
		}

		/*
		 * submission_id is deliberately absent from the payload. PostgREST's
		 * ON CONFLICT DO UPDATE only sets the columns it is given, so an overridden
		 * auto cell keeps its link to the work behind it — the student's result
		 * page is still the evidence for the number even after the teacher changed
		 * it.
		 */
		const { error } = await locals.supabase
			.from('grade')
			.upsert(rows, { onConflict: 'grade_item_id,student_id' });

		if (error) return fail(400, { message: error.message });
		return { ok: true, message: `Saved ${rows.length} ${rows.length === 1 ? 'grade' : 'grades'}.` };
	}
};
