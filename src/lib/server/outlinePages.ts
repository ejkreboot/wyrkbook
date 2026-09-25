import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

/**
 * Textbook photos on their way from a phone to the desktop outline generator.
 * See migration 011 for the bucket, the channel and why they exist.
 *
 * Two callers, two kinds of trust. The desktop is the signed-in teacher, so it
 * reads and deletes through their own client and the storage policy guards it.
 * The phone is not signed in: it holds a link the desktop was given, signed here
 * and good for LINK_LIFETIME_S, and everything it does goes through the service
 * role only after `openPhoneLink` has checked that link against the database.
 */
export const BUCKET = 'outline-pages';

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
		error(403, 'Only teachers can send textbook pages.');
	}
	return { id: profile.id, org_id: profile.org_id };
}

export function folderFor(teacher: Teacher, resourceId: string) {
	return `${teacher.org_id}/${teacher.id}/${resourceId}`;
}

export function topicFor(teacherId: string, resourceId: string) {
	return `outline-pages:${teacherId}:${resourceId}`;
}

export function checkedName(name: string) {
	if (!NAME.test(name)) error(400, 'Not a page name.');
	return name;
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
export async function phoneLinkFor(teacher: Teacher, resourceId: string, origin: string) {
	const base = PUBLIC_SITE_URL?.replace(/\/$/, '') || origin;
	const url = `${base}/phone/${resourceId}?t=${signLink(resourceId, teacher.id)}`;
	return {
		url,
		qr: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' }),
		topic: topicFor(teacher.id, resourceId)
	};
}

// ---------------------------------------------------------------- the phone

/*
 * The link is `<teacher uid>.<expiry, base-36 seconds>.<HMAC>`, bound to the
 * resource in the path. The HMAC key is derived from the service-role key, which
 * is already the most closely held secret the server has; the label keeps this
 * use of it from colliding with any other.
 */
const LINK_KEY = createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update('wyrkbook:phone-link:v1').digest();

function mac(resourceId: string, teacherId: string, exp: string) {
	return createHmac('sha256', LINK_KEY).update(`${resourceId}.${teacherId}.${exp}`).digest('base64url');
}

function signLink(resourceId: string, teacherId: string) {
	const exp = (Math.floor(Date.now() / 1000) + LINK_LIFETIME_S).toString(36);
	return `${teacherId}.${exp}.${mac(resourceId, teacherId, exp)}`;
}

export type PhoneLink = { teacherId: string; resourceId: string; title: string; folder: string };

/**
 * Checks a phone link and everything it names: the signature, the expiry, that
 * the resource exists, and that the teacher is still a teacher in the resource's
 * organisation. Errors are worded for someone holding a phone.
 */
export async function openPhoneLink(resourceId: string, token: string | null): Promise<PhoneLink> {
	const [teacherId, exp, sig] = (token ?? '').split('.');
	const valid =
		UUID.test(resourceId) &&
		UUID.test(teacherId ?? '') &&
		!!exp &&
		!!sig &&
		safeEqual(sig, mac(resourceId, teacherId, exp));
	if (!valid) error(404, 'This link isn’t valid. Scan the code on your computer again.');
	if (parseInt(exp, 36) * 1000 < Date.now()) {
		error(410, 'This link has expired. Scan the code on your computer again.');
	}

	const [{ data: resource }, { data: teacher }] = await Promise.all([
		supabaseAdmin.from('curriculum_resource').select('id, title, org_id').eq('id', resourceId).maybeSingle(),
		supabaseAdmin.from('profile').select('id, org_id, role').eq('id', teacherId).maybeSingle()
	]);
	const allowed =
		resource &&
		teacher?.org_id &&
		['admin', 'sysadmin'].includes(teacher.role) &&
		teacher.org_id === resource.org_id;
	if (!allowed) error(404, 'This link isn’t valid any more. Scan the code on your computer again.');

	return {
		teacherId,
		resourceId,
		title: resource.title,
		folder: folderFor({ id: teacherId, org_id: teacher.org_id }, resourceId)
	};
}

/** Stores one photo from the phone and tells the desktop it is there. */
export async function receivePage(link: PhoneLink, file: File) {
	const { data: waiting } = await supabaseAdmin.storage.from(BUCKET).list(link.folder, { limit: MAX_WAITING });
	if ((waiting?.length ?? 0) >= MAX_WAITING) {
		error(429, 'Your computer isn’t taking these pages. Check the outline generator is open there and has room for more.');
	}

	const name = newPageName();
	const { error: e } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(`${link.folder}/${name}`, Buffer.from(await file.arrayBuffer()), { contentType: 'image/jpeg' });
	if (e) error(500, 'The photo could not be saved. Try again.');

	// A missed announcement is not fatal: the desktop lists the folder whenever
	// it (re)subscribes, so the page still arrives.
	await supabaseAdmin.rpc('wb_outline_page_ready', {
		p_teacher: link.teacherId,
		p_resource: link.resourceId,
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
