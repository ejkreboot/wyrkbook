/**
 * Creates the first sysadmin. Run once, after the migrations are applied:
 *
 *   npm run seed:sysadmin -- you@example.com "Your Name"
 *
 * Everyone else is created from inside the app — a sysadmin adds organizations
 * and admins; an admin adds students. This script exists only because the very
 * first account has nobody to create it.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Read .env directly so the script does not depend on SvelteKit's env plumbing.
const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		})
);

const [email, displayName] = process.argv.slice(2);

if (!email?.includes('@')) {
	console.error('Usage: npm run seed:sysadmin -- you@example.com "Your Name"');
	process.exit(1);
}

const url = env.PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
	process.exit(1);
}

const supabase = createClient(url, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false }
});

const normalized = email.trim().toLowerCase();

let userId: string | undefined;

const { data: created, error: authError } = await supabase.auth.admin.createUser({
	email: normalized,
	email_confirm: true
});

if (authError) {
	if (!/already been registered|already exists/i.test(authError.message)) {
		console.error('Could not create the auth user:', authError.message);
		process.exit(1);
	}
	const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
	userId = list?.users.find((u) => u.email?.toLowerCase() === normalized)?.id;
	console.log('Auth user already existed — reusing it.');
} else {
	userId = created.user?.id;
}

if (!userId) {
	console.error('Could not resolve a user id for', normalized);
	process.exit(1);
}

const { error: profileError } = await supabase.from('profile').upsert({
	id: userId,
	org_id: null,
	role: 'sysadmin',
	display_name: displayName?.trim() || normalized.split('@')[0],
	email: normalized
});

if (profileError) {
	console.error('Could not write the profile:', profileError.message);
	process.exit(1);
}

console.log(`\n✓ ${normalized} is now a sysadmin.`);
console.log('  Sign in at /login — you will be emailed a 6-digit code.\n');
