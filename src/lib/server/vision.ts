import { error } from '@sveltejs/kit';
import type { ImagePart } from '$lib/server/anthropic';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 8;

/**
 * Turns uploaded files into base64 image parts for the Messages API.
 * HEIC is rejected rather than silently mangled — phones can be told to shoot
 * JPEG, and a wrong media_type produces confusing model errors downstream.
 */
export async function filesToImageParts(files: File[]): Promise<ImagePart[]> {
	if (!files.length) error(400, 'Attach at least one photo.');
	if (files.length > MAX_IMAGES) error(400, `Attach at most ${MAX_IMAGES} photos at a time.`);

	const parts: ImagePart[] = [];
	for (const file of files) {
		const type = file.type.toLowerCase();
		if (!ALLOWED.includes(type as (typeof ALLOWED)[number])) {
			error(
				400,
				`${file.name || 'That file'} is ${type || 'an unknown type'}. Use JPEG, PNG or WebP.`
			);
		}
		if (file.size > MAX_BYTES) {
			error(400, `${file.name || 'That photo'} is larger than 12 MB.`);
		}
		const buf = Buffer.from(await file.arrayBuffer());
		parts.push({ media_type: type, data: buf.toString('base64') });
	}
	return parts;
}

/** Pulls a JSON object out of a model response, tolerating stray prose or fences. */
export function parseJSON<T>(text: string): T {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
		const candidate =
			fenced?.[1] ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
		try {
			return JSON.parse(candidate) as T;
		} catch {
			error(502, 'The AI response could not be read. Try again.');
		}
	}
}
