import { fail } from '@sveltejs/kit';
import { createUserWithProfile, deleteUserCompletely } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { data } = await locals.supabase
		.from('profile')
		.select('*')
		.order('role')
		.order('display_name');
	return { people: data ?? [] };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const displayName = String(form.get('display_name') ?? '');
		const role = String(form.get('role') ?? 'student') === 'admin' ? 'admin' : 'student';

		if (!email.includes('@') || !displayName.trim()) {
			return fail(400, { message: 'Name and email are both required.' });
		}

		const { error } = await createUserWithProfile({
			email,
			displayName,
			role,
			orgId: locals.profile!.org_id
		});
		if (error) return fail(400, { message: error });
		return { message: `${displayName.trim()} can now sign in with their email.` };
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
		return { message: 'Removed.' };
	}
};
