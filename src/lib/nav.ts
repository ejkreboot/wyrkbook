import type { Profile } from '$lib/types';

/** Landing route for a role. Shared by the server guard and the client shell. */
export function homeFor(profile: Profile | null): string {
	if (!profile) return '/login';
	if (profile.role === 'sysadmin') return '/sysadmin';
	if (profile.role === 'admin') return '/admin';
	return '/student';
}
