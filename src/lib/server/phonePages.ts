import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

/**
 * Photos on their way from a phone to a desktop page that is waiting for them.
 * See migration 011 for the bucket, the channel and why they exist.
 *
 * Two pages wait for photos, each under a key of its own (a UUID):
 *   - `outline`: the outline generator, keyed by the curriculum resource.
 *   - `assignment`: a new assignment, which has no row yet, so the page makes up
 *     a random key for the visit.
 * The bucket and channel are still named for the first of these; neither name
 * says anything the policies depend on.
 *
 * Two callers, two kinds of trust. The desktop is the signed-in teacher, so it
 * reads and deletes through their own client and the storage policy guards it.
 * The phone is not signed in: it holds a link the desktop was given, signed here
 * and good for LINK_LIFETIME_S, and everything it does goes through the service
 * role only after `openPhoneLink` has checked that link against the database.
 */
export const BUCKET = 'outline-pages';

export const PURPOSES = ['outline', 'assignment'] as const;
export type PhonePurpose = (typeof PURPOSES)[number];

/** Leftovers from an abandoned session are removed once they are this old. */
const STALE_MS = 60 * 60 * 1000;

/** Enough for a chapter with retakes; stops a leaked link from filling the bucket. */
const MAX_WAITING = 30;

/**
 * Long enough to photograph a section; the desktop fetches a fresh link every
 * half hour, so the code on screen always has at least this minus that to run.
 */
const LINK_LIFETIME_S = 2 * 60 * 60;

/** `<ms>-<rand>.jpg`, as minted by `newPageName`. Anything else is refused. */
const NAME = /^\d{13}-[a-z0-9]{8}\.jpg$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- the desktop

type Teacher = { id: string; org_id: string };

/** The folder is under an org, so a sysadmin without one has nowhere to put pages. */
export function requireTeacher(locals: App.Locals): Teacher {
	const profile = locals.profile;
	if (!profile || !['admin', 'sysadmin'].includes(profile.role) || !profile.org_id) {
		error(403, 'Only teachers can send pages from a phone.');
	}
	return { id: profile.id, org_id: profile.org_id };
}

export function folderFor(teacher: Teacher, key: string) {
	return `${teacher.org_id}/${teacher.id}/${key}`;
}

export function topicFor(teacherId: string, key: string) {
	return `outline-pages:${teacherId}:${key}`;
}

export function checkedKey(key: string) {
	if (!UUID.test(key)) error(400, 'Not a page key.');
	return key;
}

export function checkedName(name: string) {
	if (!NAME.test(name)) error(400, 'Not a page name.');
	return name;
}

export function checkedPurpose(purpose: string | null): PhonePurpose {
	const p = purpose ?? 'outline';
	if (!(PURPOSES as readonly string[]).includes(p)) error(400, 'Not a page purpose.');
	return p as PhonePurpose;
}

/** Waiting pages, oldest first, after quietly dropping any that have gone stale. */
export async function listPages(locals: App.Locals, folder: string): Promise<string[]> {
	const { data, error: e } = await locals.supabase.storage
		.from(BUCKET)
		.list(folder, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
	if (e) error(500, e.message);

	const names = (data ?? []).map((o) => o.name).filter((n) => NAME.test(n));
	const cutoff = Date.now() - STALE_MS;
	const stale = names.filter((n) => Number(n.slice(0, 13)) < cutoff);
	if (stale.length) {
		await locals.supabase.storage.from(BUCKET).remove(stale.map((n) => `${folder}/${n}`));
	}
	return names.filter((n) => !stale.includes(n));
}

/** Empties the folder. Called whenever the desktop starts or stops listening. */
export async function clearPages(locals: App.Locals, folder: string) {
	const { data } = await locals.supabase.storage.from(BUCKET).list(folder, { limit: 100 });
	const paths = (data ?? []).map((o) => `${folder}/${o.name}`);
	if (paths.length) await locals.supabase.storage.from(BUCKET).remove(paths);
}

/** What the desktop shows: a QR for the phone page, and the channel to listen on. */
export async function phoneLinkFor(teacher: Teacher, purpose: PhonePurpose, key: string, origin: string) {
	const base = PUBLIC_SITE_URL?.replace(/\/$/, '') || origin;
	const url = `${base}/phone/${key}?t=${signLink(purpose, key, teacher.id)}`;
	return {
		url,
		qr: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' }),
		topic: topicFor(teacher.id, key)
	};
}

// ---------------------------------------------------------------- the phone

/*
 * The link is `<purpose>.<teacher uid>.<expiry, base-36 seconds>.<HMAC>`, bound
 * to the key in the path. The HMAC key is derived from the service-role key,
 * which is already the most closely held secret the server has; the label keeps
 * this use of it from colliding with any other.
 */
const LINK_KEY = createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update('wyrkbook:phone-link:v2').digest();

function mac(purpose: string, key: string, teacherId: string, exp: string) {
	return createHmac('sha256', LINK_KEY).update(`${purpose}.${key}.${teacherId}.${exp}`).digest('base64url');
}

function signLink(purpose: PhonePurpose, key: string, teacherId: string) {
	const exp = (Math.floor(Date.now() / 1000) + LINK_LIFETIME_S).toString(36);
	return `${purpose}.${teacherId}.${exp}.${mac(purpose, key, teacherId, exp)}`;
}

export type PhoneLink = {
	purpose: PhonePurpose;
	teacherId: string;
	key: string;
	/** What the photos are for, as the phone page names it. */
	title: string;
	folder: string;
};

/**
 * Checks a phone link and everything it names: the signature, the expiry, that
 * the teacher is still a teacher with an organisation and, for an outline, that
 * the resource exists in that organisation. Errors are worded for someone
 * holding a phone.
 */
export async function openPhoneLink(key: string, token: string | null): Promise<PhoneLink> {
	const [purpose, teacherId, exp, sig] = (token ?? '').split('.');
	const valid =
		(PURPOSES as readonly string[]).includes(purpose) &&
		UUID.test(key) &&
		UUID.test(teacherId ?? '') &&
		!!exp &&
		!!sig &&
		safeEqual(sig, mac(purpose, key, teacherId, exp));
	if (!valid) error(404, 'This link isn’t valid. Scan the code on your computer again.');
	if (parseInt(exp, 36) * 1000 < Date.now()) {
		error(410, 'This link has expired. Scan the code on your computer again.');
	}

	const [{ data: resource }, { data: teacher }] = await Promise.all([
		purpose === 'outline'
			? supabaseAdmin.from('curriculum_resource').select('id, title, org_id').eq('id', key).maybeSingle()
			: Promise.resolve({ data: null }),
		supabaseAdmin.from('profile').select('id, org_id, role').eq('id', teacherId).maybeSingle()
	]);
	const isTeacher = !!teacher?.org_id && ['admin', 'sysadmin'].includes(teacher.role);
	const allowed = purpose === 'outline' ? isTeacher && teacher.org_id === resource?.org_id : isTeacher;
	if (!allowed) error(404, 'This link isn’t valid any more. Scan the code on your computer again.');

	return {
		purpose: purpose as PhonePurpose,
		teacherId,
		key,
		title: resource?.title ?? 'a new assignment',
		folder: folderFor({ id: teacherId, org_id: teacher!.org_id }, key)
	};
}

/** Stores one photo from the phone and tells the desktop it is there. */
export async function receivePage(link: PhoneLink, file: File) {
	const { data: waiting } = await supabaseAdmin.storage.from(BUCKET).list(link.folder, { limit: MAX_WAITING });
	if ((waiting?.length ?? 0) >= MAX_WAITING) {
		error(429, 'Your computer isn’t taking these pages. Check the page with the code is still open there and has room for more.');
	}

	const name = newPageName();
	const { error: e } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(`${link.folder}/${name}`, Buffer.from(await file.arrayBuffer()), { contentType: 'image/jpeg' });
	if (e) error(500, 'The photo could not be saved. Try again.');

	// A missed announcement is not fatal: the desktop lists the folder whenever
	// it (re)subscribes, so the page still arrives. `p_resource` is the key,
	// whichever page it belongs to.
	await supabaseAdmin.rpc('wb_outline_page_ready', {
		p_teacher: link.teacherId,
		p_resource: link.key,
		p_name: name
	});
}

function newPageName() {
	const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
	return `${Date.now()}-${rand}.jpg`;
}

function safeEqual(a: string, b: string) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
