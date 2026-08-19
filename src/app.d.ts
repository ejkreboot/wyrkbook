import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Profile } from '$lib/types';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			/** Authenticated against the Auth server, not read from the cookie. */
			getVerifiedUser: () => Promise<User | null>;
			user: User | null;
			profile: Profile | null;
		}
		interface PageData {
			profile: Profile | null;
		}
	}
}

export {};
