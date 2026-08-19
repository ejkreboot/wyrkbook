import type { SupabaseClient } from '@supabase/supabase-js';
import { addWeeks, weekLabel } from '$lib/week';
import { MAX_PLAN_WEEKS } from '$lib/server/planDiff';
import type { PlanImport } from '$lib/types';

/**
 * The AI half of the file importer: the contract with the model, and the
 * hardening applied to whatever comes back. Kept apart from the route so it can
 * be exercised against a real document without an HTTP session — see
 * `npm run test:import`.
 */

const MAX_TITLE = 200;
const MAX_GOALS_PER_WEEK = 12;

export const PLAN_IMPORT_SCHEMA = {
	type: 'object',
	properties: {
		notes: { type: 'string' },
		weeks: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					week: { type: 'integer' },
					goals: { type: 'array', items: { type: 'string' } }
				},
				required: ['week', 'goals'],
				additionalProperties: false
			}
		}
	},
	required: ['notes', 'weeks'],
	additionalProperties: false
};

export type PlanImportReply = { notes: string; weeks: { week: number; goals: string[] }[] };

export type ImportedPlan = {
	notes: string;
	start: string;
	weeks: { week_start: string; lines: string[] }[];
};

/**
 * The document is whatever the publisher shipped — a lesson list, a syllabus, a
 * scope-and-sequence table — so the prompt describes the shape of the answer
 * rather than the shape of the input, and leans on the teacher's guidance for
 * everything the document cannot know: term length, breaks, what to skip.
 *
 * Weeks are numbered rather than dated. The model is shown the calendar so that
 * "off the week of Christmas" lands in the right box, but the mapping back to
 * Mondays is done here, where it cannot be got wrong.
 */
export function planImportPrompt(opts: { className: string; guidance: string; start: string }) {
	const calendar = Array.from(
		{ length: MAX_PLAN_WEEKS },
		(_, i) => `  week ${i + 1}: ${weekLabel(addWeeks(opts.start, i))}, ${addWeeks(opts.start, i)}`
	).join('\n');

	return `You are laying out a term plan for a homeschool class${
		opts.className ? ` called "${opts.className}"` : ''
	}.

The attached document is course material from a publisher — a lesson list,
syllabus, schedule or table of contents. Read all of it, including every column:
these documents routinely put readings in one column and quizzes, labs or exams
in another, and both belong in the plan.

Turn it into a week-by-week plan.

- Each goal is one short line a teacher will tick off, e.g. "Read chapter 4",
  "Sections 7.1-7.3", "Quiz 12", "Lab: density of water", "Semester exam".
  Under 100 characters. No numbering prefix and no dates — the week supplies
  those.
- Keep the document's own ordering, and keep an assessment in the same week as
  the material it covers unless the document says otherwise.
- A week with no work — a break, a holiday, a catch-up week — is a week with an
  empty \`goals\` array. Include it; do not skip its number.
- Number weeks consecutively from 1 with no gaps, up to ${MAX_PLAN_WEEKS}.
- Do not invent material that is not in the document, and do not drop material
  that is in it. If the guidance asks for more weeks than there is work, spread
  the work out or leave weeks empty — do not pad with filler.
- \`notes\` is two or three sentences to the teacher: how you paced it, where the
  breaks went, and anything in the document you were unsure about.

The plan starts on week 1, and every week is a Monday:

${calendar}

Guidance from the teacher${opts.guidance ? '' : ' — none was given, so use your judgement'}:
${opts.guidance || '(none)'}`;
}

/**
 * Re-keys the model's week numbers onto real Mondays and throws away anything
 * malformed. An out-of-range week number would otherwise write goals into a
 * week the planner is not showing, and an unbounded goal list would make the
 * page unusable.
 */
export function normalizePlan(parsed: PlanImportReply, start: string): ImportedPlan | null {
	const byWeek = new Map<number, string[]>();

	for (const w of parsed?.weeks ?? []) {
		const n = Math.trunc(Number(w?.week));
		if (!Number.isFinite(n) || n < 1 || n > MAX_PLAN_WEEKS) continue;
		const goals = (Array.isArray(w.goals) ? w.goals : [])
			.map((g) => String(g ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE))
			.filter(Boolean)
			.slice(0, MAX_GOALS_PER_WEEK);
		byWeek.set(n, [...(byWeek.get(n) ?? []), ...goals]);
	}

	// Trailing break weeks carry no information, so the plan ends at the last
	// week that has work in it.
	const worked = [...byWeek.entries()].filter(([, g]) => g.length).map(([n]) => n);
	if (!worked.length) return null;
	const last = Math.max(...worked);

	return {
		notes: String(parsed.notes ?? '').slice(0, 1200),
		start,
		weeks: Array.from({ length: last }, (_, i) => ({
			week_start: addWeeks(start, i),
			lines: byWeek.get(i + 1) ?? []
		}))
	};
}

/**
 * A job whose function was killed mid-read stays `running` forever with nobody
 * left to write to it. Rather than run a reaper, every read of a row settles it
 * lazily: past the invocation deadline stamped at creation, `running` means
 * dead. Called from the poll endpoint and the planner's load.
 */
export async function settleIfExpired<T extends PlanImport>(
	row: T,
	supabase: SupabaseClient
): Promise<T> {
	if (row.status !== 'running' || new Date(row.expires_at) > new Date()) return row;

	const patch = {
		status: 'failed' as const,
		error: 'The read stopped before it finished. Try it again.',
		finished_at: new Date().toISOString()
	};
	await supabase.from('plan_import').update(patch).eq('id', row.id).eq('status', 'running');
	return { ...row, ...patch };
}
