import { error, json } from '@sveltejs/kit';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicClient, MODEL, textOf } from '$lib/server/anthropic';
import { fileToContentBlock } from '$lib/server/documents';
import { parseJSON } from '$lib/server/vision';
import { deadline, defer } from '$lib/server/deferred';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import {
	normalizePlan,
	planImportPrompt,
	PLAN_IMPORT_SCHEMA,
	type PlanImportReply
} from '$lib/server/planImport';
import { parseISODate, weekStart } from '$lib/week';
import type { RequestHandler } from './$types';

const MAX_GUIDANCE = 4000;

/**
 * The response goes out in about a second, but the invocation lives on until
 * the deferred read finishes — `waitUntil` work counts against this ceiling
 * like any other. Ninety seconds is typical; 300 leaves room for a document
 * three times the size of anything we have seen.
 */
export const config = { maxDuration: 300 };

/** Runs after the response. Every exit path has to land on the row. */
async function readPlan(opts: {
	jobId: string;
	block: Anthropic.ContentBlockParam;
	className: string;
	guidance: string;
	start: string;
}) {
	const finish = (patch: Record<string, unknown>) =>
		supabaseAdmin
			.from('plan_import')
			.update({ ...patch, finished_at: new Date().toISOString() })
			.eq('id', opts.jobId);

	try {
		const stream = anthropicClient().messages.stream({
			model: MODEL,
			max_tokens: 32000,
			thinking: { type: 'adaptive' },
			output_config: {
				effort: 'high',
				format: { type: 'json_schema', schema: PLAN_IMPORT_SCHEMA }
			},
			messages: [
				{
					role: 'user',
					content: [
						opts.block,
						{ type: 'text', text: planImportPrompt(opts) }
					]
				}
			]
		});

		const response = await stream.finalMessage();

		if (response.stop_reason === 'refusal') {
			await finish({
				status: 'failed',
				error: 'The AI declined to read that file. Try a different export of it.'
			});
			return;
		}

		const plan = normalizePlan(parseJSON<PlanImportReply>(textOf(response.content)), opts.start);
		if (!plan) {
			await finish({
				status: 'failed',
				error: 'Nothing in that file read as a course plan. Try adding guidance.'
			});
			return;
		}

		await finish({ status: 'ready', notes: plan.notes, plan: plan.weeks });
	} catch (e) {
		// `parseJSON` throws SvelteKit errors, which carry their message on .body.
		const message =
			(e as { body?: { message?: string } })?.body?.message ??
			(e as Error)?.message ??
			'The read failed.';
		await finish({ status: 'failed', error: String(message).slice(0, 500) });
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can import a plan.');
	}

	const form = await request.formData();

	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'Choose a file to import.');

	const classId = String(form.get('class_id') ?? '');
	if (!classId) error(400, 'Choose a class first.');

	const guidance = String(form.get('guidance') ?? '')
		.trim()
		.slice(0, MAX_GUIDANCE);
	const className = String(form.get('class_name') ?? '')
		.trim()
		.slice(0, 120);

	const startRaw = String(form.get('start') ?? '');
	const start = /^\d{4}-\d{2}-\d{2}$/.test(startRaw)
		? weekStart(parseISODate(startRaw))
		: weekStart();

	// Read the bytes now, while the request body is still around — the deferred
	// half runs after this handler has returned and the File is long gone.
	const block = await fileToContentBlock(file);

	// Inserted through the caller's own client, so RLS is what decides they may
	// write a job for this class. The background half writes as the service role.
	const { data: job, error: insertError } = await locals.supabase
		.from('plan_import')
		.insert({
			org_id: locals.profile.org_id,
			class_id: classId,
			created_by: locals.profile.id,
			file_name: file.name || 'document',
			guidance: guidance || null,
			week_start: start,
			status: 'running',
			expires_at: deadline().toISOString()
		})
		.select('id')
		.single();

	if (insertError || !job) error(400, insertError?.message ?? 'The import could not be started.');

	defer(readPlan({ jobId: job.id, block, className, guidance, start }));

	return json({ id: job.id, status: 'running' }, { status: 202 });
};
