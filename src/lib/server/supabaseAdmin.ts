import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * Service-role client. Bypasses RLS, so it is only ever imported from `$lib/server`
 * code that has already checked the caller's role. Used for the two things RLS
 * deliberately forbids the user's own client from doing: creating auth users, and
 * writing grades / hints on a student's behalf.
 */
export const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});
