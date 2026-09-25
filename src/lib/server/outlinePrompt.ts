/**
 * The instructions for turning textbook photos into a lecture outline — the
 * server-side counterpart of scripts/outline-skill.md.
 *
 * The reference outline lives in outline-example.md so it can be edited as the
 * Markdown it is. It is passed in rather than imported here, because the route
 * reads it with Vite's `?raw` and scripts/test-outline.ts, under plain tsx,
 * reads it from disk.
 */
import type { OutlineLevel } from '../outlineLevels.ts';

const LEVEL_TEXT: Record<OutlineLevel, string> = {
	guided: `Guided — early in the course, while students are still learning to take notes. Give the structure in full, down to the third level. Make roughly half the items fill-in sentences with [[blanks]] for the key terms and facts, and make the rest specific prompts ("Define a dependent system:") with writing space. About two or three prompts per paragraph of text.`,

	standard: `Standard — match the reference outline. Mostly short topic prompts with writing space, and a fill-in sentence for each key term or fact worth knowing word for word. Roughly one or two prompts per paragraph of text. Definitions, explanations and numbers are left for the student to write.`,

	sparse: `Sparse — students can organize notes on their own now. Give the sections and their main subsections, each with writing space, and a fill-in blank only for the few terms that matter most. Roughly one prompt per two or three paragraphs of text; supporting points are the student's to find.`,

	skeletal: `Skeletal — students take their own notes. Give only the sections and subsections, each with generous writing space (four to six lines). No fill-in blanks and no third level.`
};

export function outlineSystemPrompt(level: OutlineLevel, example: string): string {
	return `You turn photos of textbook pages into a lecture outline. Students get a printed copy and fill it in while their teacher lectures, so the outline is a note-taking scaffold: it tells them what to listen for and gives them a place to write it, and leaves the content itself for them to write. It should help them learn the material and learn how to take notes. Don't spoon-feed.

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

${LEVEL_TEXT[level]}

# Reference outline

A teacher wrote this outline for part of an algebra chapter. It is the Standard level. Match its voice and shape, and set its density by the sparseness level above.

${example.trim()}
`;
}

export function outlineUserText(opts: { pages: number; className: string; instructions: string }): string {
	const lines = [
		`These ${opts.pages === 1 ? 'photo is a page' : `${opts.pages} photos are pages`} of the textbook${opts.pages === 1 ? '' : ', in order'}.`
	];
	if (opts.className) lines.push(`The class is "${opts.className}".`);
	if (opts.instructions) lines.push(`The teacher adds:\n\n${opts.instructions}`);
	lines.push('Write the outline.');
	return lines.join('\n\n');
}
