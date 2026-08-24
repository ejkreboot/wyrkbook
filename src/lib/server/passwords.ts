import { randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { Role } from '$lib/types';

/**
 * Students sign in with a username; GoTrue only knows about addresses, so each
 * student gets one under a domain that cannot receive mail. `.invalid` is
 * reserved by RFC 2606 precisely so it can never resolve — an address there is
 * well-formed enough for the auth server and guaranteed to reach nobody, which
 * is the point: nothing is ever sent to a student.
 */
export const STUDENT_EMAIL_DOMAIN = env.STUDENT_EMAIL_DOMAIN?.trim() || 'students.invalid';

/** Matches the profile_username_format constraint in migration 008. */
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

/** Short, because the people typing it are eight. Supabase's own floor is 6. */
export const MIN_PASSWORD = 6;

const PIN_TTL_HOURS = 72;
const MAX_PIN_ATTEMPTS = 5;

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase();
}

export function usernameProblem(username: string): string | null {
	if (!username) return 'Pick a username for this student.';
	if (!USERNAME_RE.test(username)) {
		return 'Usernames are 3–32 characters: lowercase letters, numbers, dot, dash or underscore.';
	}
	return null;
}

export function studentEmail(username: string): string {
	return `${username}@${STUDENT_EMAIL_DOMAIN}`;
}

export function passwordProblem(password: string, confirm?: string): string | null {
	if (password.length < MIN_PASSWORD) {
		return `Passwords need at least ${MIN_PASSWORD} characters.`;
	}
	if (confirm !== undefined && password !== confirm) return 'The two passwords do not match.';
	return null;
}

export type Identified = { id: string; email: string; role: Role; org_id: string | null };

/**
 * Who is this sign-in identifier? An address is looked up as an address and
 * anything else as a username, so the two namespaces never collide — a student
 * cannot claim a teacher's login by choosing a username that looks like one.
 *
 * Service role, because the caller is signed out: RLS gives anon nothing.
 */
export async function findByIdentifier(identifier: string): Promise<Identified | null> {
	const value = identifier.trim().toLowerCase();
	if (!value) return null;

	const column = value.includes('@') ? 'email' : 'username';
	const { data } = await supabaseAdmin
		.from('profile')
		.select('id, email, role, org_id')
		.eq(column, value)
		.maybeSingle();

	return (data as Identified) ?? null;
}

/**
 * How this identifier signs in. Unknown identifiers report 'otp' rather than
 * "no such account": the login form is public, and answering honestly would turn
 * it into a roster anyone can read a name at a time. A typo'd username lands in
 * the emailed-code flow and fails there instead, which is the same dead end by a
 * slightly longer road.
 */
export async function authModeFor(identifier: string): Promise<'password' | 'otp'> {
	const found = await findByIdentifier(identifier);
	return found?.role === 'student' ? 'password' : 'otp';
}

/**
 * Mint the PIN a student trades for a new password, replacing any live one.
 * Returned so the caller can show it to a teacher; it is not secret from them.
 */
export async function issueResetPin(studentId: string, orgId: string): Promise<string> {
	const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const expiresAt = new Date(Date.now() + PIN_TTL_HOURS * 3600_000).toISOString();

	await supabaseAdmin
		.from('password_reset')
		.upsert(
			{ student_id: studentId, org_id: orgId, pin, attempts: 0, expires_at: expiresAt },
			{ onConflict: 'student_id' }
		);

	return pin;
}

export type PinCheck = 'ok' | 'wrong' | 'expired' | 'none' | 'locked';

/**
 * Check a PIN without spending it, counting the failure if it is wrong.
 *
 * Split from `spendResetPin` so the student can be asked for the PIN and the new
 * password on two separate screens without the app holding a half-finished reset
 * anywhere: the second screen carries the PIN back and it is checked again. The
 * cost is that the honest path checks twice, which is why only failures count
 * against the attempt budget.
 */
export async function checkResetPin(studentId: string, pin: string): Promise<PinCheck> {
	const { data } = await supabaseAdmin
		.from('password_reset')
		.select('pin, attempts, expires_at')
		.eq('student_id', studentId)
		.maybeSingle();

	if (!data) return 'none';
	if (new Date(data.expires_at) < new Date()) {
		await supabaseAdmin.from('password_reset').delete().eq('student_id', studentId);
		return 'expired';
	}

	const given = Buffer.from(pin.trim());
	const expected = Buffer.from(String(data.pin));
	if (given.length === expected.length && timingSafeEqual(given, expected)) return 'ok';

	const attempts = data.attempts + 1;
	if (attempts >= MAX_PIN_ATTEMPTS) {
		// Burn it. A PIN someone is guessing at is no longer the student's.
		await supabaseAdmin.from('password_reset').delete().eq('student_id', studentId);
		return 'locked';
	}
	await supabaseAdmin.from('password_reset').update({ attempts }).eq('student_id', studentId);
	return 'wrong';
}

/**
 * Spend the PIN and set the password. Re-checks first — the PIN arrives from a
 * form field the student's browser has been holding, so the earlier check proves
 * nothing about this request.
 */
export async function spendResetPin(
	studentId: string,
	pin: string,
	password: string
): Promise<{ ok: true } | { ok: false; reason: PinCheck | 'rejected'; message: string }> {
	const check = await checkResetPin(studentId, pin);
	if (check !== 'ok') return { ok: false, reason: check, message: pinMessage(check) };

	const { error } = await supabaseAdmin.auth.admin.updateUserById(studentId, { password });
	if (error) return { ok: false, reason: 'rejected', message: error.message };

	await supabaseAdmin.from('password_reset').delete().eq('student_id', studentId);
	return { ok: true };
}

export function pinMessage(check: PinCheck): string {
	switch (check) {
		case 'wrong':
			return "That reset code isn't right. Check it with your teacher.";
		case 'expired':
			return 'That reset code has expired. Ask your teacher for a new one.';
		case 'locked':
			return 'Too many wrong tries — that code no longer works. Ask your teacher for a new one.';
		case 'none':
			return 'There is no reset code waiting for you. Ask your teacher to make one.';
		default:
			return '';
	}
}
