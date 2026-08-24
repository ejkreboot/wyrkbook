import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import {
	issueResetPin,
	normalizeUsername,
	studentEmail,
	usernameProblem
} from '$lib/server/passwords';
import type { Role } from '$lib/types';

type NewUser = {
	displayName: string;
	role: Role;
	orgId: string | null;
	/** Teachers and sysadmins only — they sign in with an emailed code. */
	email?: string;
	/** Students only. Their address is synthesized from it; see migration 008. */
	username?: string;
};

/**
 * Provisions an auth user plus its profile row. Requires the service role, since
 * RLS deliberately gives nobody the ability to mint auth users.
 *
 * `email_confirm: true` marks the address as verified without a password, which
 * is what lets a teacher sign straight in with an emailed OTP. A student is
 * created the same way — with no password at all — and gets a reset PIN instead,
 * returned here for the teacher to pass on. That way the first password a
 * student has is one they chose themselves, exactly like every one after it.
 */
export async function createUserWithProfile({ displayName, role, orgId, email, username }: NewUser) {
	const isStudent = role === 'student';
	const normalizedUsername = isStudent ? normalizeUsername(username ?? '') : null;

	if (isStudent) {
		const problem = usernameProblem(normalizedUsername!);
		if (problem) return { error: problem };
	}

	const normalized = isStudent
		? studentEmail(normalizedUsername!)
		: (email ?? '').trim().toLowerCase();

	if (!normalized.includes('@')) return { error: 'An email address is required.' };

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
		if (!userId) {
			return {
				error: isStudent
					? 'That username is already taken.'
					: 'That email already exists but could not be looked up.'
			};
		}

		const { data: existingProfile } = await supabaseAdmin
			.from('profile')
			.select('id')
			.eq('id', userId)
			.maybeSingle();
		if (existingProfile) {
			return {
				error: isStudent
					? 'That username is already taken.'
					: 'That email is already in use in wyrkbook.'
			};
		}
	}

	const { error: profileError } = await supabaseAdmin.from('profile').insert({
		id: userId,
		org_id: orgId,
		role,
		display_name: displayName.trim(),
		email: normalized,
		username: normalizedUsername
	});

	if (profileError) {
		// Don't strand an auth user with no profile — it would fail the guard forever.
		if (created?.user?.id) await supabaseAdmin.auth.admin.deleteUser(created.user.id);
		return {
			error: /profile_username_uniq|duplicate key/i.test(profileError.message)
				? 'That username is already taken.'
				: profileError.message
		};
	}

	// A student with no password and no PIN could never sign in for the first time.
	const pin = isStudent ? await issueResetPin(userId!, orgId!) : undefined;

	return { userId, pin };
}

export async function deleteUserCompletely(userId: string) {
	await supabaseAdmin.from('profile').delete().eq('id', userId);
	await supabaseAdmin.auth.admin.deleteUser(userId);
}
