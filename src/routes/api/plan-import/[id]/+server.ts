import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { PlanImport } from '$lib/types';
import { settleIfExpired } from '$lib/server/planImport';

function guard(locals: App.Locals) {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can read an import.');
	}
}

/** Polled by the planner while a read is in flight. RLS scopes it to the org. */
export const GET: RequestHandler = async ({ params, locals }) => {
	guard(locals);

	const { data } = await locals.supabase
		.from('plan_import')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!data) error(404, 'That import is gone.');

	const row = await settleIfExpired(data as PlanImport, locals.supabase);

	return json({
		id: row.id,
		status: row.status,
		file_name: row.file_name,
		notes: row.notes,
		weeks: row.plan ?? [],
		error: row.error
	});
};

/**
 * Marks an import as applied once its plan is in the teacher's text boxes, so
 * the planner stops offering it on every visit. Applied is not saved — the
 * goals still only reach the database when Save plan is pressed.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	guard(locals);

	const { error: updateError } = await locals.supabase
		.from('plan_import')
		.update({ status: 'applied' })
		.eq('id', params.id)
		.eq('status', 'ready');

	if (updateError) error(400, updateError.message);
	return json({ ok: true });
};
