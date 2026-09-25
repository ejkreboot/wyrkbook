import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import { anthropicClient, imageMessage, MODEL } from '$lib/server/anthropic';
import { filesToImageParts } from '$lib/server/vision';
import { outlineSystemPrompt, outlineUserText } from '$lib/server/outlinePrompt';
import example from '$lib/server/outline-example.md?raw';
import { DEFAULT_OUTLINE_LEVEL, isOutlineLevel } from '$lib/outlineLevels';
import type { RequestHandler } from './$types';

/** A chapter section is rarely more than this, and the pages must fit Vercel's 4.5 MB body. */
const MAX_PAGES = 10;
const MAX_INSTRUCTIONS = 2000;

/** The model call is typically one to two minutes; the response streams the whole time. */
export const config = { maxDuration: 300 };

/**
 * Textbook photos in, outline Markdown out — streamed as newline-delimited JSON
 * so the editor can fill in as the model writes:
 *
 *     {"status":"thinking"}   the model is reading the pages
 *     {"text":"..."}          a piece of the outline
 *     {"done":true}           finished cleanly
 *     {"error":"..."}         finished badly; discard what came before
 *
 * The photos exist only in this request's memory: they are read from the form,
 * sent to the API and dropped. Nothing is written to storage or the database.
 * Closing the page aborts the model call, so an abandoned run stops costing.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can generate outlines.');
	}

	const form = await request.formData();
	const files = form.getAll('images').filter((f): f is File => f instanceof File);
	const images = await filesToImageParts(files, MAX_PAGES);

	const levelRaw = String(form.get('level') ?? '');
	const level = isOutlineLevel(levelRaw) ? levelRaw : DEFAULT_OUTLINE_LEVEL;
	const className = String(form.get('class_name') ?? '').trim().slice(0, 120);
	const instructions = String(form.get('instructions') ?? '').trim().slice(0, MAX_INSTRUCTIONS);

	const client = anthropicClient();
	const encoder = new TextEncoder();
	let run: { abort(): void } | undefined;

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: Record<string, unknown>) => {
				try {
					controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
				} catch {
					// The client went away mid-write; cancel() is aborting the run.
				}
			};

			try {
				const stream = client.messages.stream({
					model: MODEL,
					max_tokens: 64000,
					thinking: { type: 'adaptive' },
					output_config: { effort: 'high' },
					system: outlineSystemPrompt(level, example),
					messages: [
						imageMessage(images, outlineUserText({ pages: images.length, className, instructions }))
					]
				});

				run = stream;

				stream.on('streamEvent', (event) => {
					if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
						send({ status: 'thinking' });
					}
				});
				stream.on('text', (text) => send({ text }));

				const message = await stream.finalMessage();
				if (message.stop_reason === 'refusal') {
					send({ error: 'The AI declined to outline those pages. Try re-shooting them, or fewer at a time.' });
				} else if (message.stop_reason === 'max_tokens') {
					send({ error: 'The outline ran too long and was cut off. Try fewer pages at a time.' });
				} else {
					send({ done: true });
				}
			} catch (e) {
				if (!(e instanceof Anthropic.APIUserAbortError)) send({ error: describe(e) });
			} finally {
				try {
					controller.close();
				} catch {
					// Already closed because the client went away.
				}
			}
		},
		cancel() {
			run?.abort();
		}
	});

	return new Response(body, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};

function describe(e: unknown): string {
	if (e instanceof Anthropic.RateLimitError) return 'The AI is busy right now. Wait a minute and try again.';
	if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.';
	if (e instanceof Anthropic.BadRequestError) return `The AI could not take that request: ${e.message}`;
	if (e instanceof Anthropic.APIError) return `The AI request failed (${e.status ?? 'network'}). Try again.`;
	console.error('[outline] generation failed', e);
	return 'The outline could not be generated. Try again.';
}
