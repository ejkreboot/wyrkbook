import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

/**
 * Constructed on first use rather than at import time, so the rest of the app
 * still boots when ANTHROPIC_API_KEY is unset — only the AI routes fail, and
 * they fail with a message that says exactly what is missing.
 */
export function anthropicClient(): Anthropic {
	if (!env.ANTHROPIC_API_KEY) {
		error(503, 'ANTHROPIC_API_KEY is not set — add it to .env and restart the server.');
	}
	client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return client;
}

export type ImagePart = { media_type: string; data: string };

/** Wraps base64 images plus a prompt into a single user turn. */
export function imageMessage(images: ImagePart[], text: string) {
	return {
		role: 'user' as const,
		content: [
			...images.map((img) => ({
				type: 'image' as const,
				source: {
					type: 'base64' as const,
					media_type: img.media_type as 'image/jpeg' | 'image/png' | 'image/webp',
					data: img.data
				}
			})),
			{ type: 'text' as const, text }
		]
	};
}

/** Pulls the text blocks out of a response. */
export function textOf(content: Anthropic.ContentBlock[]): string {
	return content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n')
		.trim();
}
