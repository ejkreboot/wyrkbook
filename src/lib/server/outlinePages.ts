import { error } from '@sveltejs/kit';

/**
 * Textbook photos on their way from a phone to the desktop outline generator.
 * See migration 011 for the bucket and why it exists.
 *
 * Every call goes through the teacher's own Supabase client, so the storage
 * policy — not this file — is what keeps one teacher out of another's folder.
 */
export const BUCKET = 'outline-pages';

/** Leftovers from an abandoned session are removed once they are this old. */
const STALE_MS = 60 * 60 * 1000;

/** `<ms>-<rand>.jpg`, as minted by `newPageName`. Anything else is refused. */
const NAME = /^\d{13}-[a-z0-9]{8}\.jpg$/;

/** The folder is under an org, so a sysadmin without one has nowhere to put pages. */
export function requireTeacher(locals: App.Locals): { id: string; org_id: string } {
	const profile = locals.profile;
	if (!profile || !['admin', 'sysadmin'].includes(profile.role) || !profile.org_id) {
		error(403, 'Only teachers can send textbook pages.');
	}
	return { id: profile.id, org_id: profile.org_id };
}

/** Proves the resource exists and is visible to this teacher under RLS. */
export async function requireResource(locals: App.Locals, id: string) {
	const { data } = await locals.supabase
		.from('curriculum_resource')
		.select('id, title')
		.eq('id', id)
		.maybeSingle();
	if (!data) error(404, 'Resource not found.');
	return data as { id: string; title: string };
}

export function folderFor(profile: { org_id: string; id: string }, resourceId: string) {
	return `${profile.org_id}/${profile.id}/${resourceId}`;
}

export function newPageName() {
	const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
	return `${Date.now()}-${rand}.jpg`;
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

/** Empties the folder. Called whenever the desktop stops listening. */
export async function clearPages(locals: App.Locals, folder: string) {
	const { data } = await locals.supabase.storage.from(BUCKET).list(folder, { limit: 100 });
	const paths = (data ?? []).map((o) => `${folder}/${o.name}`);
	if (paths.length) await locals.supabase.storage.from(BUCKET).remove(paths);
}
