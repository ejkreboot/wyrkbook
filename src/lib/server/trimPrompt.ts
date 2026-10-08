/**
 * The instructions for trimming an exercise set down to the problems worth
 * doing — what /api/trim sends, and what scripts/test-trim.ts runs outside the
 * app. Imports are relative so the script can load this under plain tsx.
 *
 * The model never sees the database. Each problem is sent with a positional
 * `key` ("1", "2", …), because labels are not unique — a lesson's practice and
 * its review block both start at 1 in plenty of books — and the reply is one
 * verdict per key, which the caller maps back onto its own rows.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { TRIM_LEVELS, trimLevelInfo, type TrimLevel } from '../trimLevels.ts';

export type TrimProblem = { label: string; section: string | null; body: string };

export type TrimVerdict = { key: string; review: boolean; keep: boolean; note: string };

export type TrimResult = { problems: TrimVerdict[]; summary: string };

export const TRIM_SCHEMA = {
	type: 'object',
	properties: {
		problems: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					key: { type: 'string' },
					review: { type: 'boolean' },
					keep: { type: 'boolean' },
					note: { type: 'string' }
				},
				required: ['key', 'review', 'keep', 'note'],
				additionalProperties: false
			}
		},
		summary: { type: 'string' }
	},
	required: ['problems', 'summary'],
	additionalProperties: false
};

const LEVEL_TEXT: Record<TrimLevel, string> = {
	light: `Drop only problems that are plainly redundant: the third and later near-identical drills of one skill.`,
	moderate: `Keep two of each kind of problem — one easier, one harder — or one when the kind is simple.`,
	heavy: `Keep one of each kind of problem, generally the harder representative, since it subsumes the easier ones. Keep one easy entry point per skill when the set climbs steeply.`,
	minimal: `Keep the fewest problems that still touch every distinct skill and variant once. The student is showing they can do each thing, not practicing it.`
};

export const TRIM_SYSTEM = `You trim textbook exercise sets for a homeschool teacher. Textbooks assign more practice than most students need: after a few problems of a kind, the rest drill the same skill the same way, and doing every one of them turns practice into tedium. You choose the subset the student will actually do. The trimmed set must stay complete — every skill, every kind of problem and the full range of difficulty in the original — with the excess repetition taken out.

# Judging redundancy

- Two problems are redundant when they exercise the same skill in the same way at about the same difficulty, differing only in numbers or surface wording.
- A problem that adds something is not redundant with the plain version: negative numbers or fractions where the others had whole numbers, an extra step, a special case (no solution, infinitely many, zero, undefined), a different form of answer, a word problem that applies the skill, or a question that asks the student to explain, estimate, check, compare or find an error. Keep at least one of each such variant.
- Sets usually climb from easy to hard. Keep that climb: the trimmed set should still start easy and end hard.
- A problem with parts (a), (b), (c) is one problem; keep or drop it whole.
- Problems that depend on each other ("use your answer to 13", "repeat exercise 9 with…") are kept or dropped together.
- Challenge, extension and critical-thinking problems are not drill. Keep them.
- A problem that refers to a figure you cannot see is judged by its words; when you cannot tell what it practices, keep it.

# Review problems

Many sets mix in problems that review earlier material, so that old skills are not forgotten. You can recognize them by:
- a section heading such as Mixed Review, Spiral Review, Cumulative Review, Review Exercises, Mixed Practice, Maintaining Skills, Keep Sharp or Test Prep;
- an earlier lesson or section number printed beside the problem;
- a topic that is plainly not the topic of this lesson's own problems.

Mark every review problem \`review: true\`, whether you keep it or not.

Review problems are not redundant with the lesson's practice, and rarely with each other: each one is usually the only practice its skill gets this week. Keep them. At the Light and Moderate levels keep every review problem. At Heavy and Minimal you may drop a review problem only when another review problem in the set drills the identical skill the identical way — and even then drop no more than about one review problem in six. When almost the whole set is review (a Saxon-style Mixed Practice, for instance), it is still review: trim it only by that rule, whatever the level.

# Levels

The teacher picks how hard to cut. The fraction is a guide to how many of the lesson's own practice problems remain, not a quota — a set with little repetition loses less, and a set that is all drill can lose more. Review problems are outside the fraction.

${TRIM_LEVELS.map((l) => `- ${l.label} (${l.keep} remain): ${LEVEL_TEXT[l.id]}`).join('\n')}

# Another selection

The teacher may have seen earlier selections at this level and asked for a different one. Where the problems in a redundant group are interchangeable, choose other representatives, so the new set differs from each earlier one as much as a good selection allows. Do not get there by cutting more or less than the level calls for, by changing which problems are review, or by dropping the review problems you would otherwise keep. If the set allows only one good selection, small differences are fine.

# The teacher's word

The teacher may add instructions ("keep all the word problems", "odd numbers only", "she has mastered two-step equations"). They outrank everything above, including the treatment of review problems.

# Reply

One entry per problem, by its key, in order:
- \`review\`: as above.
- \`keep\`: whether the student does it.
- \`note\`: a few words for the teacher, at most about ten. For a dropped problem, say why, naming the kept problem that covers it by its label as printed: "same as 7 with fractions", "repeat of 12–14". For a kept problem, leave it empty unless something about it is worth saying, such as "only word problem" or "kept: 15 builds on it".

\`summary\`: one or two plain sentences for the teacher on what the trimmed set covers and what was cut. Refer to problems by label, never by key.`;

function problemBlock(p: TrimProblem, i: number): string {
	const section = p.section?.trim() ? ` section="${p.section.trim().replace(/"/g, "'")}"` : '';
	return `<problem key="${i + 1}" label="${p.label.replace(/"/g, "'")}"${section}>\n${p.body.trim()}\n</problem>`;
}

export type TrimOptions = {
	model: string;
	problems: TrimProblem[];
	level: TrimLevel;
	/** The assignment's title, instructions and class, for context. */
	title: string;
	instructions: string;
	className: string;
	/** Free text from the teacher. */
	guidance: string;
	/** Keys kept by earlier selections at this level that the teacher passed over. */
	previous: string[][];
};

export function trimParams(opts: TrimOptions): Anthropic.MessageCreateParamsNonStreaming {
	const info = trimLevelInfo(opts.level);
	const parts: string[] = [];

	const about = [
		opts.className && `Class: ${opts.className}`,
		opts.title && `Assignment: ${opts.title}`,
		opts.instructions && `Instructions printed above the problems: ${opts.instructions}`
	].filter(Boolean);
	if (about.length) parts.push(about.join('\n'));

	parts.push(
		`The exercise set, ${opts.problems.length} problems in the order printed:\n\n${opts.problems.map(problemBlock).join('\n\n')}`
	);

	if (opts.guidance) parts.push(`The teacher adds:\n\n${opts.guidance}`);

	if (opts.previous.length) {
		parts.push(
			`The teacher has already seen ${opts.previous.length === 1 ? 'this selection' : 'these selections'} at this level and asked for another:\n\n${opts.previous
				.map((keys, i) => `${i + 1}. kept keys ${keys.join(', ')}`)
				.join('\n')}`
		);
	}

	parts.push(`Trim the set at the ${info.label} level.`);

	return {
		model: opts.model,
		max_tokens: 16000,
		thinking: { type: 'adaptive' },
		output_config: {
			effort: 'medium',
			format: { type: 'json_schema', schema: TRIM_SCHEMA }
		},
		system: TRIM_SYSTEM,
		messages: [{ role: 'user', content: parts.join('\n\n') }]
	};
}

/**
 * Lines the model's verdicts up with the problems sent, one per problem in
 * order. Anything it skipped or garbled is kept: a problem silently vanishing
 * from a student's sheet is the worse failure.
 */
export function alignVerdicts(count: number, result: Partial<TrimResult>): TrimVerdict[] {
	const byKey = new Map((result.problems ?? []).map((v) => [String(v.key).trim(), v]));
	return Array.from({ length: count }, (_, i) => {
		const key = String(i + 1);
		const v = byKey.get(key);
		return {
			key,
			review: v?.review === true,
			keep: v ? v.keep !== false : true,
			note: typeof v?.note === 'string' ? v.note.trim().slice(0, 200) : ''
		};
	});
}
