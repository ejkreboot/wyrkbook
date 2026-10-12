/**
 * The instructions for converting a teacher's own Word handout and teacher
 * notes into a curriculum resource in the house format — the Word counterpart
 * of outlinePrompt.ts, which writes outlines from textbook photos.
 *
 * The difference is whose words they are. An outline from the textbook is the
 * model's to write; an imported one is the teacher's, already taught from, so
 * this prompt is about carrying it over faithfully: the same items, wording,
 * order and sparseness, with the blanks matched to their answers.
 *
 * The documents arrive as text from $lib/docx, whose inline tags are explained
 * here, with their pictures attached as images. Graphs in the pictures are
 * redrawn as ```graph blocks ($lib/graph); other pictures are described in a
 * teacher note. The reference outline is passed in, as in outlinePrompt.ts.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { BLANK_SYNTAX } from './outlinePrompt.ts';

/**
 * The ```graph block, as a writer of one needs to know it — mirrors the
 * syntax $lib/graph reads. Kept apart so the textbook prompt can use it too.
 */
export const GRAPH_SYNTAX = `A coordinate plane or a number line is a fenced \`\`\`graph block, drawn by the app. One line per setting or item:

\`\`\`graph
x: -6..6
y: -4..8
y = x^2 - 4 "f"
y = sqrt(x + 2) for -2..6
asymptote x = 3
asymptote y = 2x + 1
x = -1
point (2, 0) x-intercept
open point (3, 5) "hole"
[[y = 2x + 1 "g"]]
\`\`\`

- \`x:\` and \`y:\` are the ranges shown, as \`min..max\`, with \`step n\` after for grid lines n apart (whole units otherwise). y defaults to the x range. Other settings: \`size: small\`, \`medium\` (the default) or \`large\`, and \`numbers: off\` for axes left unnumbered.
- \`y = …\` (or \`f(x) = …\`) draws a function of x, over the whole range or \`for a..b\`, with an optional "quoted label". Write expressions plainly: \`3(x - 1)^2 + 2\`, \`1/(x - 2)\`, \`sqrt(x)\`, \`abs(x)\`, \`2sin(x)\`, \`e^x\`, \`ln x\`, \`pi\`. No LaTeX inside a graph.
- \`asymptote x = a\` and \`asymptote y = …\` are dashed lines; \`x = a\` is a solid vertical line.
- \`point (a, b) label\` is a filled dot, \`open point (a, b)\` an open one.
- A number line is \`number line: -5..5\` with \`point a\` and \`open point a\` items.
- A line wrapped in \`[[ ]]\` is an answer: drawn on the teacher's copy only. The student's copy shows the plane without it.
- Inside an outline item, the block goes on lines of its own after a blank line, indented four spaces deeper than the item's \`-\`, with a blank line after it:

\`\`\`\`
    - Sketch the graph of $y = x^2 - 4$.

        \`\`\`graph
        x: -5..5
        [[y = x^2 - 4]]
        \`\`\`

    - Next item
\`\`\`\``;

export function importSystemPrompt(example: string): string {
	return `You convert a teacher's lecture materials from Word into the Markdown format of their curriculum app. A lecture usually comes as two documents: the handout students fill in while the teacher lectures, and the teacher's own copy — the same outline with the answers filled in, or a fuller set of notes. Sometimes there is only one of them. The app keeps both in one document: what students see, with the answers and the teacher's notes inside it in markup that is removed from the student's printout.

This is the teacher's material, already taught from. Convert it; don't rewrite it. Keep every item, in order, in the teacher's words. Don't add content, drop content, merge items, reword them, or change how much the handout gives away — a sparse handout stays sparse. Your judgment is for the mapping: which line is which level, where each blank is and what its answer is, and what belongs only to the teacher.

# The documents

Each document is plain text read from Word, with these marks where Word had them:

- \`# \` and \`## \` start lines in Word's title and heading styles.
- A list item starts with its label as Word numbered it (\`II.\`, \`b)\`, \`3.\`, \`•\`) and a tab, after one leading tab per level of nesting. Other indented lines start with a tab per indent. Teachers also type labels and tabs by hand; read those the same way.
- \`<b>\`, \`<i>\`, \`<u>\`, \`<s>\` are bold, italic, underline and strikethrough; \`<color C00000>\` is a font color (hex) and \`<mark yellow>\` a highlight; \`<hidden>\` is hidden text. Underlined spaces or tabs, and runs of underscores, are blanks.
- \`$…$\` and \`$$…$$\` are Word equations, roughly converted to LaTeX.
- \`| a | b |\` lines are the rows of a table.
- \`[3 empty lines]\` stands for that many empty paragraphs or line breaks in a row: usually space left for writing.
- \`[picture 3]\` is a picture, attached after the documents as the image labeled Picture 3. A picture both documents share has one number. \`[picture]\` with no number is one that could not be extracted (a chart, a linked file).
- \`[equation object]\` is an equation stored as an image (MathType, or Word's old equation editor) that could not be read.

In a teacher's copy, text set apart by color, highlight, hidden text, or underline where the handout has a blank is the answer to that blank.

# Format

Reply with the Markdown and nothing else: no preamble, no closing remarks, no code fence around it.

- First line: a level-1 heading with the lecture's title, as the documents give it.
- The outline goes inside a \`::: outline\` … \`:::\` block. The app numbers it by depth: I. → a. → i. → 1. Leave the documents' own labels (I., A., 1., a)) out of the item text.
- Write top-level items as numbered-list items with the number the document gives them, so a handout that starts at IV. starts with \`4.\` and a II. is \`2.\`. Unnumbered top-level items are numbered in order from 1.
- Every level below the top is a \`-\` item, indented four spaces per level. Keep the documents' depth.
- What is not part of the outline — an introduction, a table, a list of vocabulary, practice problems — stays where it is, as ordinary Markdown outside the block (a table as a Markdown table). Close the block before it and open another after it if the outline carries on.
- All math in KaTeX: \`$...$\` inline, \`$$...$$\` on lines of their own for display. That includes math typed as plain text, such as x^2, 2x - y = 10, or √x; tidy the equations from Word into valid KaTeX.
- Drop the formatting marks: they are only clues for finding blanks and answers. Where the teacher used emphasis for its own sake, the outline does without it.
- Leave out the parts of a page that are not the lecture: Name / Date / Period lines, page numbers, running headers and footers, and blank space left only for layout. Space below an item is not layout: it is writing space (below).

## Blanks, writing space and teacher notes

${BLANK_SYNTAX}
- Put a blank where the handout has one. A blank inside a sentence is \`[[answer]]\`. Empty lines or space left below an item for writing is \`[[n: answer]]\` at the end of that item, with n the number of lines the handout leaves, from 1 to 12 — \`[3 empty lines]\` is n = 3.
- The answers come from the teacher's copy. Where it doesn't give one, leave the answer empty — \`[[ ]]\` or \`[[3: ]]\` — rather than supplying one yourself, unless the teacher asks you to.
- Where the handout leaves space and the teacher's copy fills the same place with notes, keep both: the space as \`[[n: …]]\` sized to the handout's empty lines, and the notes as teacher notes. The handout's space is never lost to a note.
- Where the handout's spacing can't be read — there is only a teacher's copy, or the space below an item isn't marked with empty lines — infer it. Judge how much room a student would need under each item from what they are asked to write there: the answer or notes the teacher's copy gives, the kind of prompt it is, and how the rest of the handout is spaced. An example or problem the student solves needs a line for every step of the teacher's worked solution, as above. Then give that item \`[[n: …]]\`. An item that is only a heading or a fill-in sentence needs none.
- With only a teacher's copy, its answers mark the blanks: answer text set apart by color, highlight, underline or hidden text becomes a blank holding it.
- \`{{text}}\` is a teacher note: shown to the teacher in blue, removed from the student's copy. Everything in the teacher's copy that isn't on the handout and isn't a blank's answer is a teacher note — a reminder, an example to put on the board, an explanation to give, a question to ask. Keep the teacher's words in full. Put each note where it belongs: at the end of the item it goes with, as an item of its own (\`- {{…}}\`), or as a paragraph of its own outside the outline.
- Where the documents have an \`[equation object]\`, write a teacher note in its place, such as \`{{Equation from the Word handout — retype it here}}\`. If the teacher's copy or the surrounding text makes the equation clear, write it in KaTeX instead.

## Pictures and graphs

${GRAPH_SYNTAX}

Look at every attached picture and put something in its place:

- A coordinate plane, graph of a function, or number line becomes a graph block that reproduces it: the ranges and grid spacing read off its axes, its curves as equations, its points and labels, its asymptotes. Take each equation from the text where it is given (\`Graph y = x^2 - 4\`) and read it off the picture where it isn't: intercepts, vertex, asymptotes, a point or two. An empty grid is a block with only its settings.
- Keep the document's order around a picture. Writing space the handout leaves below a picture goes below its graph block, as a \`[[n: answer]]\` line of its own indented like the block, with a blank line before it — not at the end of the item above.
- Compare the handout's picture with the teacher's copy's. What the teacher's copy draws that the handout leaves blank is the answer: those lines go in \`[[ ]]\`. With only one document, what is drawn stays drawn, unless the text plainly asks students to draw it (\`Graph f\`, \`Sketch …\`) — then it is the answer.
- Where a graph has something the block can't draw — shading, an axis marked in multiples of π, arrows or notes drawn on it — draw what it can and add a teacher note saying what is left out.
- Any other picture — a diagram, a figure, a photo, a table pasted as an image — becomes a teacher note in its place that describes it well enough to recreate: \`{{Picture: right triangle ABC with legs 3 and 4, hypotenuse c}}\`. A table pasted as an image can be written out as a Markdown table instead.
- Leave out pictures that are only decoration: a school logo, clip art, a border.
- A picture the request says was not attached, and a \`[picture]\` with no number, becomes \`{{Picture in the Word handout}}\`, with what the text around it says it shows if anything.

# How it looks

This outline was written in the app. Match its format; its density is the teacher's to set, not yours.

${example.trim()}
`;
}

export type ImportDocument = { name: string; text: string };
export type ImportPicture = { n: number; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

/**
 * One lecture's documents in, the resource's Markdown out. Either document can
 * be missing, not both. Lining two documents up and matching each blank to its
 * answer is careful work but not hard reading, so it thinks at medium effort —
 * high when there are pictures, since reading a graph's equation off a picture
 * is. `missing` numbers the pictures the browser couldn't send.
 */
export function importParams(opts: {
	model: string;
	example: string;
	handout: ImportDocument | null;
	teacher: ImportDocument | null;
	pictures: ImportPicture[];
	missing: number[];
	className: string;
	instructions: string;
}): Anthropic.MessageStreamParams {
	const doc = (tag: string, d: ImportDocument) =>
		`<${tag} file="${d.name.replace(/"/g, "'")}">\n${d.text.trim()}\n</${tag}>`;

	const parts: string[] = [];
	if (opts.handout && opts.teacher) {
		parts.push(
			`These are the two documents for one lecture: the student handout, and the teacher's copy.`,
			doc('handout', opts.handout),
			doc('teacher_copy', opts.teacher)
		);
	} else if (opts.handout) {
		parts.push(
			`This is the student handout for a lecture. There is no teacher's copy, so any answers are only those the handout itself holds, such as hidden text.`,
			doc('handout', opts.handout)
		);
	} else if (opts.teacher) {
		parts.push(
			`This is the teacher's copy of a lecture. There is no separate handout, so the student's version is this one with its answers taken out as blanks, its teacher-only material as notes, and room left to write wherever a student would.`,
			doc('teacher_copy', opts.teacher)
		);
	}

	const after: string[] = [];
	if (opts.missing.length) {
		const list = opts.missing.map((n) => `${n}`).join(', ');
		after.push(`Picture${opts.missing.length === 1 ? '' : 's'} ${list} could not be attached — an old Word drawing format, or past the number of pictures one import sends.`);
	}
	if (opts.className) after.push(`The class is "${opts.className}".`);
	if (opts.instructions) after.push(`The teacher adds:\n\n${opts.instructions}`);
	after.push('Convert the lecture into the app’s format.');

	const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: parts.join('\n\n') }];
	for (const p of opts.pictures) {
		content.push(
			{ type: 'text', text: `Picture ${p.n}:` },
			{ type: 'image', source: { type: 'base64', media_type: p.media_type, data: p.data } }
		);
	}
	content.push({ type: 'text', text: after.join('\n\n') });

	return {
		model: opts.model,
		max_tokens: 64000,
		thinking: { type: 'adaptive' },
		output_config: { effort: opts.pictures.length ? 'high' : 'medium' },
		system: [{ type: 'text', text: importSystemPrompt(opts.example), cache_control: { type: 'ephemeral' } }],
		messages: [{ role: 'user', content }]
	};
}
