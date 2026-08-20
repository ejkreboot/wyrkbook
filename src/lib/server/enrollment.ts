import { fail, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The class ids a student is on, or `null` when no student is being filtered by.
 *
 * Null and `[]` mean opposite things and both are reachable: null is "no filter,
 * show every class", `[]` is "this student is on no roster, show nothing". A
 * caller that collapsed them would silently show a teacher the whole school when
 * they asked about a student who has not been enrolled yet.
 */
export async function classesForStudent(
	supabase: SupabaseClient,
	studentId: string
): Promise<string[] | null> {
	if (!studentId) return null;
	const { data } = await supabase
		.from('enrollment')
		.select('class_id')
		.eq('student_id', studentId);
	return (data ?? []).map((e) => e.class_id as string);
}

/**
 * Roster mutations. Shared verbatim by /admin/classes (one class, many students)
 * and /admin/students (one student, many classes) — the same row viewed from
 * either end, so it must behave identically from either page.
 */
export const enrollmentActions = {
	enroll: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		const studentId = String(form.get('student_id') ?? '');

		if (!classId || !studentId) {
			return fail(400, { message: 'Pick a class and a student.' });
		}

		/*
		 * RLS keeps this inside the org, but it has nothing to say about roles —
		 * the profile foreign key would happily accept a teacher. Check the role
		 * here so a mistyped id cannot put an admin on a roster.
		 */
		const { data: student } = await locals.supabase
			.from('profile')
			.select('id, display_name, role')
			.eq('id', studentId)
			.maybeSingle();

		if (!student || student.role !== 'student') {
			return fail(400, { message: 'That person is not a student in your organization.' });
		}

		// Idempotent: adding someone already on the roster is a no-op, not an error,
		// because both pages can be open at once on the same pair.
		const { error } = await locals.supabase
			.from('enrollment')
			.upsert(
				{ org_id: locals.profile!.org_id, class_id: classId, student_id: studentId },
				{ onConflict: 'class_id,student_id', ignoreDuplicates: true }
			);

		if (error) return fail(400, { message: error.message });
		return { ok: true, message: `Added ${student.display_name} to the class.` };
	},

	unenroll: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		const studentId = String(form.get('student_id') ?? '');

		const { error } = await locals.supabase
			.from('enrollment')
			.delete()
			.eq('class_id', classId)
			.eq('student_id', studentId);

		if (error) return fail(400, { message: error.message });
		return { ok: true, message: 'Removed from the class.' };
	}
};
