import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { Role } from '$lib/types';

type NewUser = { email: string; displayName: string; role: Role; orgId: string | null };

/**
 * Provisions an auth user plus its profile row. Requires the service role, since
 * RLS deliberately gives nobody the ability to mint auth users.
 *
 * `email_confirm: true` marks the address as verified without a password, which
 * is what lets the person sign straight in with an emailed OTP.
 */
export async function createUserWithProfile({ email, displayName, role, orgId }: NewUser) {
	const normalized = email.trim().toLowerCase();

	const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
		email: normalized,
		email_confirm: true
	});

	let userId = created?.user?.id;

	if (authError) {
		// The address may already exist from another org or an earlier attempt.
		if (!/already been registered|already exists/i.test(authError.message)) {
			return { error: authError.message };
		}
		const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
		userId = list?.users.find((u) => u.email?.toLowerCase() === normalized)?.id;
		if (!userId) return { error: 'That email already exists but could not be looked up.' };

		const { data: existingProfile } = await supabaseAdmin
			.from('profile')
			.select('id')
			.eq('id', userId)
			.maybeSingle();
		if (existingProfile) return { error: 'That email is already in use in wyrkbook.' };
	}

	const { error: profileError } = await supabaseAdmin.from('profile').insert({
		id: userId,
		org_id: orgId,
		role,
		display_name: displayName.trim(),
		email: normalized
	});

	if (profileError) {
		// Don't strand an auth user with no profile — it would fail the guard forever.
		if (created?.user?.id) await supabaseAdmin.auth.admin.deleteUser(created.user.id);
		return { error: profileError.message };
	}

	return { userId };
}

export async function deleteUserCompletely(userId: string) {
	await supabaseAdmin.from('profile').delete().eq('id', userId);
	await supabaseAdmin.auth.admin.deleteUser(userId);
}
