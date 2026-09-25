import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';

let client: SupabaseClient | undefined;

/**
 * The one Supabase client that runs in the browser, for Realtime only — every
 * read and write still goes through the server. It picks up the session from
 * the same cookies the server sets, so private channels are authorised as the
 * signed-in teacher. Call it from browser-only code (effects, handlers).
 */
export function supabaseBrowser(): SupabaseClient {
	return (client ??= createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY));
}
