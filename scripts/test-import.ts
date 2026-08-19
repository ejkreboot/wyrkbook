/**
 * Runs a real document through the plan importer's prompt and prints the plan
 * it produces. This is the only way to tell whether the prompt actually reads a
 * publisher's two-column lesson list — a unit test can only check the shape.
 *
 *   npm run test:import -- "NPS Lesson List.pdf" "Spread over 40 weeks, break at Christmas"
 *
 * It costs an API call. Nothing is written to the database.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
	normalizePlan,
	planImportPrompt,
	PLAN_IMPORT_SCHEMA,
	type PlanImportReply
} from '../src/lib/server/planImport.ts';
import { weekLabel, weekStart } from '../src/lib/week.ts';

/**
 * Overridable so the same document can be run past a cheaper model:
 *   MODEL=claude-haiku-4-5 npm run test:import -- <file> "<guidance>"
 */
const MODEL = process.env.MODEL ?? 'claude-opus-5';

// Haiku 4.5 predates adaptive thinking and rejects `effort` outright, so the
// request shape has to bend for it.
const LEGACY_THINKING = /haiku-4-5|sonnet-4-5|opus-4-5/.test(MODEL);

const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			// Values may be quoted; SvelteKit's loader strips those, so this must too.
			return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
		})
);

const [path, guidance = '', className = 'Physical Science'] = process.argv.slice(2);

if (!path) {
	console.error('Usage: npm run test:import -- <file> [guidance] [class name]');
	process.exit(1);
}

const apiKey = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error('ANTHROPIC_API_KEY must be set in .env');
	process.exit(1);
}

const start = weekStart();
const bytes = readFileSync(path);
const isPdf = path.toLowerCase().endsWith('.pdf');

const block: Anthropic.ContentBlockParam = isPdf
	? {
			type: 'document',
			title: basename(path),
			source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') }
		}
	: {
			type: 'document',
			title: basename(path),
			source: { type: 'text', media_type: 'text/plain', data: bytes.toString('utf8') }
		};

const t0 = Date.now();

const stream = new Anthropic({ apiKey }).messages.stream({
	model: MODEL,
	max_tokens: 32000,
	thinking: LEGACY_THINKING ? { type: 'enabled', budget_tokens: 8000 } : { type: 'adaptive' },
	output_config: LEGACY_THINKING
		? { format: { type: 'json_schema', schema: PLAN_IMPORT_SCHEMA } }
		: { effort: 'high', format: { type: 'json_schema', schema: PLAN_IMPORT_SCHEMA } },
	messages: [
		{
			role: 'user',
			content: [block, { type: 'text', text: planImportPrompt({ className, guidance, start }) }]
		}
	]
});

// A cheaper model can take minutes on this; without a heartbeat there is no way
// to tell a slow run from a hung one.
let chars = 0;
stream.on('text', (t) => (chars += t.length));
const beat = setInterval(
	() => console.error(`  … ${((Date.now() - t0) / 1000).toFixed(0)}s, ${chars} chars`),
	15_000
);

const response = await stream.finalMessage().finally(() => clearInterval(beat));

if (response.stop_reason === 'refusal') {
	console.error('Refused:', response.stop_details);
	process.exit(1);
}

const text = response.content
	.filter((b): b is Anthropic.TextBlock => b.type === 'text')
	.map((b) => b.text)
	.join('\n');

const plan = normalizePlan(JSON.parse(text) as PlanImportReply, start);

if (!plan) {
	console.error('Nothing read as a plan. Raw response:\n', text.slice(0, 2000));
	process.exit(1);
}

console.log(`\n${plan.notes}\n`);
for (const [i, w] of plan.weeks.entries()) {
	const label = `week ${String(i + 1).padStart(2)} · ${weekLabel(w.week_start)}`;
	console.log(w.lines.length ? `${label}\n    ${w.lines.join('\n    ')}` : `${label}\n    —`);
}

const total = plan.weeks.reduce((n, w) => n + w.lines.length, 0);
console.log(
	`\n${total} goals across ${plan.weeks.length} weeks · ` +
		`${response.usage.input_tokens} in / ${response.usage.output_tokens} out · ` +
		`${((Date.now() - t0) / 1000).toFixed(0)}s`
);
