/**
 * Markdown for curriculum resources: CommonMark plus tables, KaTeX math and
 * teacher notes. Shared by the editor's live preview, the reader and the print
 * page, so all three agree on what a document looks like.
 *
 * Math is `$inline$` and `$$display$$` (on its own lines or inline). A `$` that
 * opens on whitespace or closes before a digit is left alone, so "between $5 and
 * $10" stays prose — the same rule Pandoc uses. `\$` is always a literal dollar.
 *
 * Teacher notes are `{{double braces}}`, anywhere inline text goes:
 *
 *     - Limits {{ask them to guess the sign first}}
 *     - {{Pause here and draw the graph}}
 *
 * They render in place as blue text. `notes: false` never makes tokens for them
 * at all — they are not hidden, they are absent — which is what makes a handout
 * safe to hand out. A paragraph, heading or list item left empty by that is
 * dropped too, so a handout outline has no blank "b." and no gap in numbering.
 *
 * Blanks are `[[double brackets]]` holding the answer:
 *
 *     - Two equations in the same variables form a [[system]].
 *     - Solution set: [[2: every ordered pair that satisfies both]]
 *
 * The first is a fill-in blank; a leading `n:` makes it n lines of writing
 * space instead. The handout gets the empty blank or space, the teacher copy
 * the answer written into it in blue. Answers are teacher-only, exactly like
 * notes: with `notes: false` they are never tokenized.
 *
 * Outlines are fenced around ordinary nested lists:
 *
 *     ::: outline
 *     - Limits
 *         - Intuition
 *     :::
 *
 * The Markdown is untouched; CSS marks each depth I. → a. → 1. → – whether the
 * items are typed `-` or `1.`. Lists outside the block render as usual.
 *
 * Raw HTML is off. The body is typed by a teacher and read by other teachers in
 * the org; there is no reason for one of them to be able to run script in the
 * other's session.
 */
import MarkdownIt, { type Token } from 'markdown-it';
import container, { type ContainerOpts } from 'markdown-it-container';
import katex from 'katex';

type InlineRule = Parameters<MarkdownIt['inline']['ruler']['after']>[2];
type BlockRule = Parameters<MarkdownIt['block']['ruler']['after']>[2];
type CoreRule = Parameters<MarkdownIt['core']['ruler']['after']>[2];

const DOLLAR = 0x24;
const BRACE = 0x7b;
const BRACKET = 0x5b;

function tex(src: string, displayMode: boolean): string {
	try {
		return katex.renderToString(src, {
			displayMode,
			throwOnError: false, // a typo renders red in place rather than blanking the page
			strict: 'ignore',
			output: 'htmlAndMathml'
		});
	} catch {
		return `<code class="math-error">${md.utils.escapeHtml(src)}</code>`;
	}
}

const mathInline: InlineRule = (state, silent) => {
	const src = state.src;
	const pos = state.pos;
	if (src.charCodeAt(pos) !== DOLLAR) return false;

	const display = src.charCodeAt(pos + 1) === DOLLAR;
	const fence = display ? '$$' : '$';
	const start = pos + fence.length;

	if (!display && /\s/.test(src[start] ?? ' ')) return false;

	let end = start;
	for (;;) {
		end = src.indexOf(fence, end);
		if (end === -1 || end >= state.posMax) return false;
		if (src[end - 1] !== '\\') break;
		end += 1;
	}
	if (end === start) return false;
	if (!display && (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? ''))) return false;

	if (!silent) {
		const token = state.push(display ? 'math_display' : 'math_inline', 'math', 0);
		token.markup = fence;
		token.content = src.slice(start, end);
	}
	state.pos = end + fence.length;
	return true;
};

const mathBlock: BlockRule = (state, startLine, endLine, silent) => {
	let pos = state.bMarks[startLine] + state.tShift[startLine];
	let max = state.eMarks[startLine];

	if (state.sCount[startLine] - state.blkIndent >= 4) return false; // indented code
	if (state.src.slice(pos, pos + 2) !== '$$') return false;

	let first = state.src.slice(pos + 2, max);
	let last = '';
	let next = startLine;
	let closed = false;

	if (first.trim().endsWith('$$')) {
		first = first.trim().slice(0, -2);
		closed = true;
	}
	while (!closed) {
		next++;
		if (next >= endLine) break;
		pos = state.bMarks[next] + state.tShift[next];
		max = state.eMarks[next];
		if (pos < max && state.sCount[next] < state.blkIndent) break; // dedented out of a list
		const line = state.src.slice(pos, max).trim();
		if (line.endsWith('$$')) {
			last = line.slice(0, -2);
			closed = true;
		}
	}
	if (!closed) return false;
	if (silent) return true;

	const middle = next > startLine ? state.getLines(startLine + 1, next, state.tShift[startLine], true) : '';
	const token = state.push('math_block', 'math', 0);
	token.block = true;
	token.markup = '$$';
	token.content = [first, middle, last].filter((s) => s.trim()).join('\n');
	token.map = [startLine, next + 1];
	state.line = next + 1;
	return true;
};

type InlineState = Parameters<InlineRule>[0];

/**
 * Finds a doubled closing character (`}}`, `]]`) from `start`, stepping over
 * whole tokens the way link labels are scanned — so a `}}` inside math like
 * $x^{2}}$ or a code span can't end the span early. -1 if there is none.
 */
function findClose(state: InlineState, start: number, code: number): number {
	const pos = state.pos;
	let end = -1;
	state.pos = start;
	while (state.pos < state.posMax) {
		if (state.src.charCodeAt(state.pos) === code && state.src.charCodeAt(state.pos + 1) === code) {
			end = state.pos;
			break;
		}
		state.md.inline.skipToken(state);
	}
	state.pos = pos;
	return end;
}

/** Parses src[start, end) as inline Markdown into the current token stream. */
function tokenizeRange(state: InlineState, start: number, end: number) {
	const max = state.posMax;
	state.pos = start;
	state.posMax = end;
	state.md.inline.tokenize(state);
	state.posMax = max;
}

const teacherNote: InlineRule = (state, silent) => {
	const pos = state.pos;
	if (state.src.charCodeAt(pos) !== BRACE || state.src.charCodeAt(pos + 1) !== BRACE) return false;

	const start = pos + 2;
	const end = findClose(state, start, 0x7d);
	if (end === -1 || end === start) return false;

	if (!silent && state.env?.notes !== false) {
		state.push('teacher_note_open', 'span', 1).attrSet('class', 'teacher-note');
		tokenizeRange(state, start, end);
		state.push('teacher_note_close', 'span', -1);
	}
	state.pos = end + 2;
	return true;
};

/**
 * `[[answer]]` is a fill-in blank; `[[3: answer]]` is three lines of writing
 * space. Either way the answer is teacher-only: with `notes: false` the span
 * is emitted empty and the answer is never tokenized.
 */
const blank: InlineRule = (state, silent) => {
	const pos = state.pos;
	if (state.src.charCodeAt(pos) !== BRACKET || state.src.charCodeAt(pos + 1) !== BRACKET) return false;

	let start = pos + 2;
	const end = findClose(state, start, 0x5d);
	if (end === -1 || end === start) return false;

	if (!silent) {
		const open = state.push('blank_open', 'span', 1);
		const lines = /^\s*(\d{1,2})\s*:/.exec(state.src.slice(start, end));
		if (lines) {
			open.attrSet('class', 'write');
			open.attrSet('style', `--lines:${Math.min(12, Math.max(1, Number(lines[1])))}`);
			start += lines[0].length;
		} else {
			open.attrSet('class', 'blank');
		}
		if (state.env?.notes !== false) tokenizeRange(state, start, end);
		state.push('blank_close', 'span', -1);
	}
	state.pos = end + 2;
	return true;
};

/** True when an inline token has no text of its own outside teacher notes. */
function onlyNotes(inline: Token): boolean {
	let depth = 0;
	return (inline.children ?? []).every((c) => {
		if (c.type === 'teacher_note_open') depth++;
		else if (c.type === 'teacher_note_close') depth--;
		else if (depth === 0 && c.type !== 'softbreak' && !(c.type === 'text' && !c.content.trim()))
			return false;
		return true;
	});
}

const PRUNABLE = new Set(['paragraph', 'heading', 'list_item', 'bullet_list', 'ordered_list', 'container_outline']);

/**
 * Handout: drops blocks that held nothing but notes — an empty paragraph, then
 * the list item, list or outline that emptied out around it.
 * Teacher copy: marks list items that are wholly a note, so their marker goes
 * blue too and the teacher can see which items the handout will skip.
 */
const tidyNotes: CoreRule = (state) => {
	const tokens = state.tokens;
	if (state.env?.notes !== false) {
		tokens.forEach((t, i) => {
			if (t.type === 'list_item_open' && tokens[i + 2]?.type === 'inline' && onlyNotes(tokens[i + 2]))
				t.attrJoin('class', 'note-item');
		});
		return;
	}
	const out: Token[] = [];
	for (const t of tokens) {
		const top = out[out.length - 1];
		const opener = top?.type === t.type.replace(/_close$/, '_open');
		if (t.type === 'inline' && onlyNotes(t) && (top?.type === 'paragraph_open' || top?.type === 'heading_open'))
			continue;
		if (t.nesting === -1 && opener && PRUNABLE.has(t.type.slice(0, -'_close'.length))) {
			out.pop();
			continue;
		}
		out.push(t);
	}
	state.tokens = out;
};

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.after('blockquote', 'math_block', mathBlock, {
	alt: ['paragraph', 'reference', 'blockquote', 'list']
});
md.renderer.rules.math_inline = (tokens, i) => tex(tokens[i].content, false);
md.renderer.rules.math_display = (tokens, i) => tex(tokens[i].content, true);
md.renderer.rules.math_block = (tokens, i) =>
	`<div class="math-block">${tex(tokens[i].content, true)}</div>\n`;

md.inline.ruler.after('math_inline', 'teacher_note', teacherNote);
md.inline.ruler.after('teacher_note', 'blank', blank); // ahead of `link`, which would take `[[`
md.core.ruler.after('inline', 'teacher_notes', tidyNotes);

// Typed on its own: md.use() takes plugin options as any[], which would leave
// the render callback untyped.
const outlineBlock: ContainerOpts = {
	render: (tokens, i) => (tokens[i].nesting === 1 ? '<div class="outline">\n' : '</div>\n')
};
md.use(container, 'outline', outlineBlock);

export type RenderOptions = {
	/** Include `{{teacher notes}}`. False for anything a student will see. */
	notes?: boolean;
};

export function renderMarkdown(src: string, { notes = true }: RenderOptions = {}): string {
	return md.render(src ?? '', { notes });
}

/** How many teacher notes a body carries — for the reader's toggle label. */
export function countNotes(src: string): number {
	return md
		.parse(src ?? '', { notes: true })
		.flatMap((t) => t.children ?? [])
		.filter((t) => t.type === 'teacher_note_open').length;
}
