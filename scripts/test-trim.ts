/**
 * Runs the trimmer's prompt outside the app and prints what it keeps and drops
 * — the way to tune src/lib/server/trimPrompt.ts without clicking through the
 * editor.
 *
 *   npm run test:trim -- moderate set.json
 *   npm run test:trim -- heavy set.json 3      three selections in a row, each
 *                                              told about the ones before it
 *
 * `set.json` is an array of problems, as extraction writes them:
 *
 *   [{ "label": "1", "section": "Practice", "body": "Solve $2x + 3 = 11$." }, …]
 *
 * Level is light, moderate, heavy or minimal. NOTES sets the teacher's
 * guidance, TITLE the assignment title. Every run costs API calls.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { isTrimLevel } from '../src/lib/trimLevels.ts';
import { alignVerdicts, trimParams, type TrimProblem, type TrimResult } from '../src/lib/server/trimPrompt.ts';

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

const [level, path, runsArg] = process.argv.slice(2);
if (!isTrimLevel(level) || !path) {
	console.error('Usage: npm run test:trim -- <light|moderate|heavy|minimal> <set.json> [runs]');
	process.exit(1);
}

const apiKey = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error('ANTHROPIC_API_KEY must be set in .env');
	process.exit(1);
}

const problems: TrimProblem[] = (JSON.parse(readFileSync(path, 'utf8')) as Partial<TrimProblem>[]).map((p, i) => ({
	label: String(p.label ?? i + 1),
	section: p.section ?? null,
	body: String(p.body ?? '')
}));

const client = new Anthropic({ apiKey });
const previous: string[][] = [];

for (let run = 1; run <= Math.max(1, Number(runsArg) || 1); run++) {
	const t0 = Date.now();
	const response = await client.messages.create(
		trimParams({
			model: MODEL,
			problems,
			level,
			title: process.env.TITLE ?? '',
			instructions: '',
			className: '',
			guidance: process.env.NOTES ?? '',
			previous
		})
	);
	if (response.stop_reason === 'refusal') {
		console.error('refused:', response.stop_details);
		process.exit(1);
	}

	const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
	const result = JSON.parse(text) as TrimResult;
	const verdicts = alignVerdicts(problems.length, result);

	console.log(`\n── selection ${run} ─────────────────────────────`);
	for (const [i, v] of verdicts.entries()) {
		const p = problems[i];
		const mark = v.keep ? 'KEEP' : '    ';
		const review = v.review ? 'review' : '      ';
		const body = p.body.replace(/\s+/g, ' ').slice(0, 60);
		console.log(`${mark} ${review} ${p.label.padStart(4)}  ${body.padEnd(60)}  ${v.note}`);
	}
	const kept = verdicts.filter((v) => v.keep);
	const reviews = verdicts.filter((v) => v.review);
	console.log(`\n${result.summary}`);
	console.error(
		`kept ${kept.length}/${verdicts.length} · review kept ${reviews.filter((v) => v.keep).length}/${reviews.length} · ` +
			`${response.usage.input_tokens} in / ${response.usage.output_tokens} out · ${((Date.now() - t0) / 1000).toFixed(0)}s`
	);

	previous.push(kept.map((v) => v.key));
}
