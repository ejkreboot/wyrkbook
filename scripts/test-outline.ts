/**
 * Runs the outline generator's prompts outside the app and prints the Markdown
 * they write — the way to tune the prompt or the reference outline
 * (src/lib/server/outline-example.md) without clicking through the app.
 *
 * From photos, as the app does it: the pages are read into a Guided outline,
 * which is then rewritten at the level asked for.
 *
 *   npm run test:outline -- standard p212.jpg p213.jpg p214.jpg > outline.md
 *
 * From a Guided outline already written (no photos, so it is quick and cheap —
 * save one with `-- guided p212.jpg … > guided.md`):
 *
 *   npm run test:outline -- sparse guided.md
 *
 * Level is guided, standard, sparse or skeletal. Photos must be JPEG, PNG or
 * WebP under 5 MB; on a Mac, `sips -s format jpeg -Z 2000 IMG.heic --out p.jpg`
 * converts and shrinks an iPhone photo. CLASS and NOTES set the class name and
 * the teacher's notes. Every run costs API calls.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { isOutlineLevel } from '../src/lib/outlineLevels.ts';
import { outlineParams, relevelParams } from '../src/lib/server/outlinePrompt.ts';

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
	console.error('Usage: npm run test:outline -- <guided|standard|sparse|skeletal> <photo> [photo…] | <guided.md>');
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

const example = readFileSync(new URL('../src/lib/server/outline-example.md', import.meta.url), 'utf8');
const client = new Anthropic({ apiKey });
const common = { model: MODEL, example, className: process.env.CLASS ?? '', instructions: process.env.NOTES ?? '' };

/** Runs one request, sending the outline to `out` as it is written and a summary line to stderr. */
async function run(label: string, params: Anthropic.MessageStreamParams, out: (t: string) => void) {
	const t0 = Date.now();
	const stream = client.messages.stream(params);
	stream.on('text', out);
	const beat = setInterval(() => console.error(`  … ${label} ${((Date.now() - t0) / 1000).toFixed(0)}s`), 15_000);
	const response = await stream.finalMessage().finally(() => clearInterval(beat));

	if (response.stop_reason === 'refusal') {
		console.error(`\n${label} refused:`, response.stop_details);
		process.exit(1);
	}
	const u = response.usage;
	console.error(
		`\n${label}: ${response.stop_reason} · ${u.input_tokens} in (${u.cache_read_input_tokens ?? 0} cached) / ` +
			`${u.output_tokens} out · ${((Date.now() - t0) / 1000).toFixed(0)}s`
	);
}

let guided = '';
if (paths.length === 1 && paths[0].endsWith('.md')) {
	guided = readFileSync(paths[0], 'utf8');
} else {
	const images = paths.map((path) => {
		const media_type = TYPES[(path.split('.').pop() ?? '').toLowerCase()];
		if (!media_type) {
			console.error(`${path}: use JPEG, PNG or WebP.`);
			process.exit(1);
		}
		const bytes = readFileSync(path);
		if (bytes.length > 5 * 1024 * 1024) {
			console.error(`${path} is over 5 MB. Shrink it: sips -Z 2000 "${path}"`);
			process.exit(1);
		}
		return { media_type, data: bytes.toString('base64') };
	});

	// Guided is the answer itself, so it streams to stdout; otherwise it is only the source.
	await run('pages → guided', outlineParams({ ...common, images }), (t) => {
		guided += t;
		if (level === 'guided') process.stdout.write(t);
	});
}

if (level !== 'guided') {
	await run(`guided → ${level}`, relevelParams({ ...common, guided, current: '', level }), (t) => process.stdout.write(t));
}
