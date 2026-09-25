/**
 * Runs real textbook photos through the outline generator's prompt and prints
 * the Markdown it writes — the way to tune the prompt or the reference outline
 * (src/lib/server/outline-example.md) without clicking through the app.
 *
 *   npm run test:outline -- standard p212.jpg p213.jpg p214.jpg > outline.md
 *
 * Level is guided, standard, sparse or skeletal. Photos must be JPEG, PNG or
 * WebP under 5 MB; on a Mac, `sips -s format jpeg -Z 2000 IMG.heic --out p.jpg`
 * converts and shrinks an iPhone photo. It costs an API call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { isOutlineLevel } from '../src/lib/outlineLevels.ts';
import { outlineSystemPrompt, outlineUserText } from '../src/lib/server/outlinePrompt.ts';

const MODEL = process.env.MODEL ?? 'claude-opus-5-5';

const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
		})
);

const [level, ...paths] = process.argv.slice(2);
if (!isOutlineLevel(level) || !paths.length) {
	console.error('Usage: npm run test:outline -- <guided|standard|sparse|skeletal> <photo> [photo…]');
	process.exit(1);
}

const apiKey = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error('ANTHROPIC_API_KEY must be set in .env');
	process.exit(1);
}

const TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

const images = paths.map((path) => {
	const type = TYPES[(path.split('.').pop() ?? '').toLowerCase()];
	if (!type) {
		console.error(`${path}: use JPEG, PNG or WebP.`);
		process.exit(1);
	}
	const bytes = readFileSync(path);
	if (bytes.length > 5 * 1024 * 1024) {
		console.error(`${path} is over 5 MB. Shrink it: sips -Z 2000 "${path}"`);
		process.exit(1);
	}
	return {
		type: 'image' as const,
		source: { type: 'base64' as const, media_type: type, data: bytes.toString('base64') }
	};
});

const example = readFileSync(new URL('../src/lib/server/outline-example.md', import.meta.url), 'utf8');
const t0 = Date.now();

const stream = new Anthropic({ apiKey }).messages.stream({
	model: MODEL,
	max_tokens: 64000,
	thinking: { type: 'adaptive' },
	output_config: { effort: 'high' },
	system: outlineSystemPrompt(level, example),
	messages: [
		{
			role: 'user',
			content: [
				...images,
				{
					type: 'text',
					text: outlineUserText({ pages: images.length, className: process.env.CLASS ?? '', instructions: process.env.NOTES ?? '' })
				}
			]
		}
	]
});

// The outline goes to stdout as it is written; progress goes to stderr.
stream.on('text', (t) => process.stdout.write(t));
const beat = setInterval(() => console.error(`  … ${((Date.now() - t0) / 1000).toFixed(0)}s`), 15_000);
const response = await stream.finalMessage().finally(() => clearInterval(beat));

if (response.stop_reason === 'refusal') {
	console.error('\nRefused:', response.stop_details);
	process.exit(1);
}
console.error(
	`\n\n${response.stop_reason} · ${response.usage.input_tokens} in / ${response.usage.output_tokens} out · ` +
		`${((Date.now() - t0) / 1000).toFixed(0)}s`
);
