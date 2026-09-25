/**
 * The browser end of $lib/server/outlineStream: posts a request and hands the
 * outline to `ontext` as it arrives.
 *
 * 'error' means what streamed in should be thrown away, and `problem` says why;
 * 'stopped' means the signal aborted it and what arrived is the caller's to keep.
 */
export type Outcome = 'done' | 'stopped' | 'error';

export async function streamOutline(
	url: string,
	init: RequestInit & { signal: AbortSignal },
	on: {
		/** The request was accepted and the model is working. */
		start?: () => void;
		/** Once when the model starts thinking, once when it starts writing. */
		status?: (phase: 'thinking' | 'writing') => void;
		text: (text: string) => void;
	}
): Promise<{ outcome: Outcome; problem: string }> {
	let outcome: Outcome = 'error';
	let problem = '';
	let writing = false;

	try {
		const res = await fetch(url, { method: 'POST', ...init });
		if (!res.ok || !res.body) return { outcome, problem: tidyError(await res.text(), res.status) };
		on.start?.();

		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffered = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffered += value;
			let nl: number;
			while ((nl = buffered.indexOf('\n')) !== -1) {
				const line = buffered.slice(0, nl).trim();
				buffered = buffered.slice(nl + 1);
				if (!line) continue;
				const event = JSON.parse(line) as { text?: string; status?: string; done?: boolean; error?: string };
				if (event.text) {
					if (!writing) on.status?.('writing');
					writing = true;
					on.text(event.text);
				} else if (event.status === 'thinking') {
					on.status?.('thinking');
				} else if (event.error) {
					problem = event.error;
				} else if (event.done) {
					outcome = 'done';
				}
			}
		}
		if (outcome !== 'done' && !problem) problem = 'The connection closed before the outline was finished.';
	} catch {
		if (init.signal.aborted) outcome = 'stopped';
		else problem = 'The request failed. Check your connection and try again.';
	}
	return { outcome, problem };
}

/** SvelteKit `error()` responses are JSON; fall back to the raw text. */
function tidyError(text: string, code: number) {
	try {
		return JSON.parse(text).message ?? `Request failed (${code}).`;
	} catch {
		return code === 413
			? 'Those photos are too large to send together. Try fewer pages.'
			: text.slice(0, 200) || `Request failed (${code}).`;
	}
}
