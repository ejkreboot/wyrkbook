import { fail } from '@sveltejs/kit';
import { createUserWithProfile, deleteUserCompletely } from '$lib/server/users';
import { enrollmentActions } from '$lib/server/enrollment';
import { issueResetPin, normalizeUsername, usernameProblem } from '$lib/server/passwords';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ data: people }, { data: classes }, { data: enrollments }, { data: resets }] =
		await Promise.all([
			locals.supabase.from('profile').select('*').order('role').order('display_name'),
			// Archived classes are not offered, but an existing enrollment in one is
			// still shown — otherwise it would silently disappear from the roster.
			locals.supabase.from('class').select('id, name, color, archived').order('name'),
			locals.supabase.from('enrollment').select('class_id, student_id'),
			// The PINs students are waiting to be read. RLS (migration 008) allows
			// admins to read these and nobody to write them.
			locals.supabase.from('password_reset').select('student_id, pin, expires_at')
		]);

	return {
		people: people ?? [],
		classes: classes ?? [],
		enrollments: enrollments ?? [],
		resets: resets ?? []
	};
};

/**
 * Confirm the target is a student this admin may act on before touching the
 * service role, which does not enforce RLS. The read goes through the caller's
 * own client on purpose: if RLS hides the row, they have no business with it.
 */
async function studentInScope(locals: App.Locals, id: string) {
	const { data } = await locals.supabase
		.from('profile')
		.select('id, display_name, org_id, role')
		.eq('id', id)
		.maybeSingle();
	return data?.role === 'student' ? data : null;
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const displayName = String(form.get('display_name') ?? '');
		const role = String(form.get('role') ?? 'student') === 'admin' ? 'admin' : 'student';
		const email = String(form.get('email') ?? '');
		const username = normalizeUsername(String(form.get('username') ?? ''));

		if (!displayName.trim()) return fail(400, { message: 'A name is required.' });

		if (role === 'student') {
			const problem = usernameProblem(username);
			if (problem) return fail(400, { message: problem });
		} else if (!email.includes('@')) {
			return fail(400, { message: 'Teachers sign in by email, so an address is required.' });
		}

		const { error, pin } = await createUserWithProfile({
			displayName,
			role,
			orgId: locals.profile!.org_id,
			email,
			username
		});
		if (error) return fail(400, { message: error });

		return {
			ok: true,
			message:
				role === 'student'
					? `${displayName.trim()} can sign in as ${username}. Give them the code ${pin} to set their first password.`
					: `${displayName.trim()} can now sign in with their email.`
		};
	},

	remove: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (id === locals.profile!.id) {
			return fail(400, { message: "You can't remove your own account." });
		}

		// Confirm the target really belongs to this admin's org before using the
		// service role, which does not enforce RLS.
		const { data: target } = await locals.supabase
			.from('profile')
			.select('id')
			.eq('id', id)
			.maybeSingle();
		if (!target) return fail(403, { message: 'That person is not in your organization.' });

		await deleteUserCompletely(id);
		return { ok: true, message: 'Removed.' };
	},

	/**
	 * Hand a student a way back in without learning their password. The PIN buys
	 * one reset and the student chooses what it becomes; a teacher who wants to
	 * know a student's password still has no way to find out, which is the point
	 * of doing it this way rather than letting the teacher type one.
	 */
	issue_pin: async ({ request, locals }) => {
		const form = await request.formData();
		const student = await studentInScope(locals, String(form.get('id') ?? ''));
		if (!student) return fail(403, { message: 'That person is not a student in your organization.' });

		const pin = await issueResetPin(student.id, student.org_id!);
		return {
			ok: true,
			message: `Reset code for ${student.display_name}: ${pin}. It works once, and expires in three days.`
		};
	},

	/** Called it out to the wrong person, or they remembered after all. */
	clear_pin: async ({ request, locals }) => {
		const form = await request.formData();
		const student = await studentInScope(locals, String(form.get('id') ?? ''));
		if (!student) return fail(403, { message: 'That person is not a student in your organization.' });

		await supabaseAdmin.from('password_reset').delete().eq('student_id', student.id);
		return { ok: true, message: `Reset code for ${student.display_name} cancelled.` };
	},

	...enrollmentActions
};
