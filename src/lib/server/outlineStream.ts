import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from '$lib/server/anthropic';

/**
 * Runs an outline request and streams it back as newline-delimited JSON, so the
 * browser can follow along as the model writes:
 *
 *     {"status":"thinking"}   the model is reading
 *     {"text":"..."}          a piece of the outline
 *     {"done":true}           finished cleanly
 *     {"error":"..."}         finished badly; discard what came before
 *
 * Closing the page aborts the model call, so an abandoned run stops costing.
 * $lib/outlineStream reads it on the other end. `refusal` is what the teacher
 * is told if the model declines.
 */
export function streamOutline(params: Anthropic.MessageStreamParams, refusal: string): Response {
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
				const stream = client.messages.stream(params);
				run = stream;

				stream.on('streamEvent', (event) => {
					if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
						send({ status: 'thinking' });
					}
				});
				stream.on('text', (text) => send({ text }));

				const message = await stream.finalMessage();
				if (message.stop_reason === 'refusal') {
					send({ error: refusal });
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
}

function describe(e: unknown): string {
	if (e instanceof Anthropic.RateLimitError) return 'The AI is busy right now. Wait a minute and try again.';
	if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.';
	if (e instanceof Anthropic.BadRequestError) return `The AI could not take that request: ${e.message}`;
	if (e instanceof Anthropic.APIError) return `The AI request failed (${e.status ?? 'network'}). Try again.`;
	console.error('[outline] generation failed', e);
	return 'The outline could not be generated. Try again.';
}
