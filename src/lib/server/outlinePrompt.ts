/**
 * The instructions for turning textbook photos into a lecture outline — the
 * server-side counterpart of scripts/outline-skill.md.
 *
 * Two requests share one system prompt, so the second is a cache hit on the
 * first: outlineParams reads the photos and writes the Guided outline, and
 * relevelParams rewrites that Guided outline at another level from the text
 * alone. The level is named in the user turn for the same reason.
 *
 * The reference outline lives in outline-example.md so it can be edited as the
 * Markdown it is. It is passed in rather than imported here, because the route
 * reads it with Vite's `?raw` and scripts/test-outline.ts, under plain tsx,
 * reads it from disk.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { levelInfo, type OutlineLevel } from '../outlineLevels.ts';

const LEVEL_TEXT: Record<OutlineLevel, string> = {
	guided: `Guided — early in the course, while students are still learning to take notes. Give the structure in full, down to the third level. Make roughly half the items fill-in sentences with [[blanks]] for the key terms and facts, and make the rest specific prompts ("Define a dependent system:") with writing space. About two or three prompts per paragraph of text.`,

	standard: `Standard — match the reference outline. Mostly short topic prompts with writing space, and a fill-in sentence for each key term or fact worth knowing word for word. Roughly one or two prompts per paragraph of text. Definitions, explanations and numbers are left for the student to write.`,

	sparse: `Sparse — students can organize notes on their own now. Give the sections and their main subsections, each with writing space, and a fill-in blank only for the few terms that matter most. Roughly one prompt per two or three paragraphs of text; supporting points are the student's to find.`,

	skeletal: `Skeletal — students take their own notes. Give only the sections and subsections, each with generous writing space (four to six lines). No fill-in blanks and no third level.`
};

export function outlineSystemPrompt(example: string): string {
	return `You write lecture outlines from photos of textbook pages. Students get a printed copy and fill it in while their teacher lectures, so the outline is a note-taking scaffold: it tells them what to listen for and gives them a place to write it, and leaves the content itself for them to write. It should help them learn the material and learn how to take notes. Don't spoon-feed.

You are asked to outline the photos, to continue an outline you wrote with the pages that follow, or to rewrite an outline you wrote at a different sparseness level. A continuation is only the lines that carry the outline on, so it leaves out the heading and the block's fences.

# Format

Reply with the outline in Markdown and nothing else: no preamble, no closing remarks, no code fence around it.

- First line: a level-1 heading with the book's title if the pages show it, then the chapter number and title, e.g. \`# Algebra & Trigonometry Chapter 4: Systems of Linear Equations and Inequalities\`.
- Then the outline, inside one \`::: outline\` … \`:::\` block. The renderer numbers it by depth: I. → a. → i. → 1.
- Top-level items are the book's sections, titled as the book titles them. Write each with the section's number within the chapter as a numbered-list marker, so section 4.2 is \`2.\` and prints as II. If the pages begin at 4.3, the first item is \`3.\`.
- Every level below the top is a \`-\` item, indented four spaces per level. Use at most three levels below the top, and the last of those only when it is really needed.
- All math in KaTeX: \`$...$\` inline, \`$$...$$\` on lines of their own for display. Never plain-text math such as x^2 or 2x - y = 10.
- No bold, italics or other emphasis. The renderer bolds the top level itself.

## Blanks, writing space and teacher notes

- \`[[answer]]\` is a fill-in blank. The student's copy shows an empty line about fifteen characters wide; the teacher's copy shows the answer on it. Use it for a key word or short term inside a sentence the student completes: \`Two or more equations with the same variables form a [[system]] of equations.\`
- \`[[n: answer]]\`, at the end of an item, is n lines of writing space below it, from 1 to 6. The student's copy is blank there; the teacher's copy shows what the student should write, briefly: a phrase, a one-sentence definition, a formula. Size n to what a student would really write: 2 for a short definition, 3 or 4 for a formula with its explanation or a worked example.
- Every blank and every writing space carries its answer, taken from the pages. The answers are for the teacher, so keep them short and exact.
- \`{{text}}\` is a teacher note: shown to the teacher in blue, removed from the student's copy. Use one only when a teacher would genuinely want the reminder, such as which figure to put on the board. Most outlines need none.

# Content

- Skip sidebars and boxed features, worked examples set off in boxes or by markers, figure captions, footnotes, exercise sets, and opinion or devotional asides.
- Skip the tail of a section that began before these pages unless it is substantial.
- A worked example in the running text can be a prompt with writing space, as in the reference outline.
- Subsections and main concepts go at the second level, supporting points at the third.
- Plain wording in the teacher's voice.
- Don't add homework or exercise assignments; the teacher sets those.
- Work only from what is on the pages. If a page is unreadable, outline what you can read.

# Sparseness

The teacher picks one of four levels, from the most hand-holding to the least, and moves a class down them over the term. Each request names the level to write.

${Object.values(LEVEL_TEXT)
	.map((t) => `- ${t}`)
	.join('\n')}

# Reference outline

A teacher wrote this outline for part of an algebra chapter. It is the Standard level. Match its voice and shape, and set its density by the level the request names.

${example.trim()}
`;
}

type Common = {
	model: string;
	/** The reference outline, outline-example.md. */
	example: string;
	className: string;
	instructions: string;
};

function teacherLines({ className, instructions }: Pick<Common, 'className' | 'instructions'>) {
	const lines: string[] = [];
	if (className) lines.push(`The class is "${className}".`);
	if (instructions) lines.push(`The teacher adds:\n\n${instructions}`);
	return lines;
}

function system(example: string): Anthropic.TextBlockParam[] {
	return [{ type: 'text', text: outlineSystemPrompt(example), cache_control: { type: 'ephemeral' } }];
}

const CONTINUATION = `only the new items, as they go inside the \`::: outline\` block after its last line, with no heading and no \`:::\` lines`;

/**
 * Photos in, the Guided outline out. Reading the pages is the hard part, so this
 * one thinks hard. With `continues` — the Guided outline of the pages before
 * these — it writes only the lines that carry that outline on.
 */
export function outlineParams(
	opts: Common & { images: { media_type: string; data: string }[]; continues?: string }
): Anthropic.MessageStreamParams {
	const n = opts.images.length;
	const pages = `${n === 1 ? 'This photo is a page' : `These ${n} photos are pages`} of the textbook${n === 1 ? '' : ', in order'}.`;
	const text = opts.continues?.trim()
		? [
				`${pages} They pick up where the pages you outlined earlier left off. This is the Guided outline of those:\n\n<outline_so_far>\n${opts.continues.trim()}\n</outline_so_far>`,
				...teacherLines(opts),
				`Write the Guided outline of these new pages as a continuation of it: ${CONTINUATION}. Carry on its section numbering, and if the pages carry on the section it ends in, carry on inside that section rather than starting a new top-level item.`
			]
		: [pages, ...teacherLines(opts), `Write the outline at the ${levelInfo('guided').label} level.`];

	return {
		model: opts.model,
		max_tokens: 64000,
		thinking: { type: 'adaptive' },
		output_config: { effort: 'high' },
		system: system(opts.example),
		messages: [
			{
				role: 'user',
				content: [
					...opts.images.map((img) => ({
						type: 'image' as const,
						source: {
							type: 'base64' as const,
							media_type: img.media_type as 'image/jpeg' | 'image/png' | 'image/webp',
							data: img.data
						}
					})),
					{ type: 'text', text: text.join('\n\n') }
				]
			}
		]
	};
}

/**
 * The Guided outline in, the same outline at another level out — no photos, so
 * it is quick and cheap. `current` is the outline as it stands in the teacher's
 * document, sent only when they have edited it, so their changes carry over.
 *
 * With `addition` — the Guided continuation written from pages added later — it
 * writes only that continuation, at the level of `current`, to add to its end.
 */
export function relevelParams(
	opts: Common & { guided: string; current: string; level: OutlineLevel; addition?: string }
): Anthropic.MessageStreamParams {
	const label = levelInfo(opts.level).label;
	const parts = [
		`You outlined some textbook pages earlier at the Guided level. The photos are gone; this outline is your record of the pages, so work only from it.\n\n<guided_outline>\n${opts.guided.trim()}\n</guided_outline>`
	];
	if (opts.addition?.trim()) {
		parts.push(
			`The teacher then photographed the pages that follow, and you outlined them at the Guided level as this continuation:\n\n<continuation>\n${opts.addition.trim()}\n</continuation>`,
			`The teacher's document has the outline of the earlier pages at the ${label} level:\n\n<current_outline>\n${opts.current.trim()}\n</current_outline>`,
			...teacherLines(opts),
			`Write the continuation at the ${label} level, to follow on from the document's outline: ${CONTINUATION}.`
		);
	} else if (opts.current.trim()) {
		parts.push(
			`The teacher has been working from a version of it and has edited it. This is the version in their document now:\n\n<current_outline>\n${opts.current.trim()}\n</current_outline>\n\nCarry the teacher's edits into the new outline wherever the level has room for them: their wording, answers and teacher notes win over the Guided outline, items they removed stay out, and items they added stay in.`
		);
	}
	if (!opts.addition?.trim()) parts.push(...teacherLines(opts), `Rewrite the outline at the ${label} level.`);

	return {
		model: opts.model,
		max_tokens: 64000,
		thinking: { type: 'adaptive' },
		output_config: { effort: 'low' },
		system: system(opts.example),
		messages: [{ role: 'user', content: parts.join('\n\n') }]
	};
}
