import { fail } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { createUserWithProfile, deleteUserCompletely } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { data: orgs } = await supabaseAdmin
		.from('organization')
		.select('*')
		.order('created_at', { ascending: true });

	const { data: people } = await supabaseAdmin
		.from('profile')
		.select('*')
		.neq('role', 'sysadmin')
		.order('created_at', { ascending: true });

	return {
		orgs: orgs ?? [],
		people: people ?? []
	};
};

export const actions: Actions = {
	createOrg: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Give the organization a name.' });

		const { error } = await supabaseAdmin.from('organization').insert({ name });
		if (error) return fail(400, { message: error.message });
		return { message: `Created ${name}.` };
	},

	createAdmin: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const displayName = String(form.get('display_name') ?? '');
		const orgId = String(form.get('org_id') ?? '');

		if (!email.includes('@') || !displayName.trim() || !orgId) {
			return fail(400, { message: 'Name, email and organization are all required.' });
		}

		const { error } = await createUserWithProfile({
			email,
			displayName,
			role: 'admin',
			orgId
		});
		if (error) return fail(400, { message: error });
		return { message: `${displayName} can now sign in as an admin.` };
	},

	deletePerson: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing user.' });
		await deleteUserCompletely(id);
		return { message: 'Removed.' };
	}
};
