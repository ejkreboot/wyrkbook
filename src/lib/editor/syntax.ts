/**
 * The curriculum Markdown dialect ($lib/markdown) taught to the editor's Lezer
 * parser, so the live editor can find math, teacher notes, blanks and outline
 * fences by position. markdown-it still does all the real rendering; this only
 * has to agree with it on where each construct starts and ends, and it follows
 * the same rules for that — the same dollar heuristics, `}}` and `]]` found by
 * stepping over math and code spans, `::: outline` fences that end a paragraph.
 *
 * Node names, for $lib/editor/live:
 *
 *     InlineMath   $x$ or $$x$$ inside a line      MathMark on each fence
 *     MathBlock    $$ on its own lines              MathMark on each fence
 *     TeacherNote  {{…}}                            NoteMark on each end
 *     Blank        [[…]] or [[3: …]]                BlankMark on each end, BlankLines on `3:`
 *     OutlineFence a `::: outline` or `:::` line    OutlineMark on the `:::`
 */
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';

const DOLLAR = 0x24;
const BACKTICK = 0x60;
const BACKSLASH = 0x5c;
const BRACE = 0x7b;
const BRACKET = 0x5b;

/** Where math opening at s[i] ends (past its closing fence), or -1 — $lib/markdown's mathInline, on a string. */
function matchMath(s: string, i: number): number {
	if (s.charCodeAt(i) !== DOLLAR) return -1;
	const display = s.charCodeAt(i + 1) === DOLLAR;
	const fence = display ? '$$' : '$';
	const start = i + fence.length;
	if (!display && /\s/.test(s[start] ?? ' ')) return -1;
	let end = start;
	for (;;) {
		end = s.indexOf(fence, end);
		if (end === -1) return -1;
		if (s[end - 1] !== '\\') break;
		end += 1;
	}
	if (end === start) return -1;
	if (!display && (/\s/.test(s[end - 1]) || /\d/.test(s[end + 1] ?? ''))) return -1;
	return end + fence.length;
}

/** Steps over one whole token at s[i] — an escape, a code span, math — or one character. */
function skipToken(s: string, i: number): number {
	const c = s.charCodeAt(i);
	if (c === BACKSLASH) return i + 2;
	if (c === BACKTICK) {
		let n = i;
		while (s.charCodeAt(n) === BACKTICK) n++;
		const run = s.slice(i, n);
		const close = s.indexOf(run, n);
		return close === -1 ? n : close + run.length;
	}
	if (c === DOLLAR) {
		const end = matchMath(s, i);
		if (end !== -1) return end;
	}
	return i + 1;
}

/** Index of the first doubled `code` from `start` that isn't inside a token, or -1. */
function findClose(s: string, start: number, code: number): number {
	for (let i = start; i < s.length; i = skipToken(s, i))
		if (s.charCodeAt(i) === code && s.charCodeAt(i + 1) === code) return i;
	return -1;
}

/** `{{…}}` and `[[…]]`: the span, its marks, and its content parsed as inline Markdown. */
function doubled(cx: InlineContext, pos: number, open: number, close: number, node: string, mark: string) {
	const s = cx.text;
	const rel = pos - cx.offset;
	if (s.charCodeAt(rel) !== open || s.charCodeAt(rel + 1) !== open) return -1;
	const end = findClose(s, rel + 2, close);
	if (end === -1 || end === rel + 2) return -1;

	let start = rel + 2;
	const children = [cx.elt(mark, pos, pos + 2)];
	if (node === 'Blank') {
		const lines = /^\s*\d{1,2}\s*:/.exec(s.slice(start, end));
		if (lines) {
			children.push(cx.elt('BlankLines', cx.offset + start, cx.offset + start + lines[0].length));
			start += lines[0].length;
		}
	}
	children.push(...cx.parser.parseInline(s.slice(start, end), cx.offset + start));
	children.push(cx.elt(mark, cx.offset + end, cx.offset + end + 2));
	return cx.addElement(cx.elt(node, pos, cx.offset + end + 2, children));
}

const OUTLINE_FENCE = /^:::[ \t]*(outline\b.*)?$/;
const isOutlineFence = (line: Line) => line.indent - line.baseIndent < 4 && OUTLINE_FENCE.test(line.text.slice(line.pos).trimEnd());
const isMathOpen = (line: Line) => line.indent - line.baseIndent < 4 && line.text.startsWith('$$', line.pos);
/** The line's container depth: internal to Lezer, but what its own FencedCode uses to stay in its list. */
const depth = (line: Line) => (line as Line & { depth: number }).depth;

export const curriculumSyntax: MarkdownConfig = {
	// markdown-it renders with html: false — an HTML tag is just text.
	remove: ['HTMLTag', 'HTMLBlock'],
	defineNodes: [
		'InlineMath',
		{ name: 'MathBlock', block: true },
		'MathMark',
		'TeacherNote',
		'NoteMark',
		'Blank',
		'BlankMark',
		'BlankLines',
		{ name: 'OutlineFence', block: true },
		'OutlineMark'
	],
	parseInline: [
		{
			name: 'InlineMath',
			after: 'Escape',
			parse(cx, next, pos) {
				if (next !== DOLLAR) return -1;
				const end = matchMath(cx.text, pos - cx.offset);
				if (end === -1) return -1;
				const fence = cx.char(pos + 1) === DOLLAR ? 2 : 1;
				const to = cx.offset + end;
				return cx.addElement(
					cx.elt('InlineMath', pos, to, [cx.elt('MathMark', pos, pos + fence), cx.elt('MathMark', to - fence, to)])
				);
			}
		},
		{
			name: 'TeacherNote',
			after: 'InlineMath',
			parse: (cx, next, pos) => (next === BRACE ? doubled(cx, pos, BRACE, 0x7d, 'TeacherNote', 'NoteMark') : -1)
		},
		{
			name: 'Blank',
			before: 'Link', // which would take the `[[`
			parse: (cx, next, pos) => (next === BRACKET ? doubled(cx, pos, BRACKET, 0x5d, 'Blank', 'BlankMark') : -1)
		}
	],
	parseBlock: [
		{
			name: 'MathBlock',
			before: 'Blockquote',
			parse(cx: BlockContext, line: Line) {
				if (!isMathOpen(line)) return false;
				const from = cx.lineStart + line.pos;
				const first = line.text.slice(line.pos + 2).trim();
				const marks = [cx.elt('MathMark', from, from + 2)];
				let closed = first.length >= 2 && first.endsWith('$$');
				if (closed) {
					const end = cx.lineStart + line.text.trimEnd().length;
					marks.push(cx.elt('MathMark', end - 2, end));
				}
				// Unclosed, it runs to the end of its list or the document — like a code
				// fence being typed — where markdown-it would give up and print a paragraph.
				while (!closed && cx.nextLine() && depth(line) >= cx.depth) {
					const text = line.text.trimEnd();
					if (text.endsWith('$$')) {
						closed = true;
						marks.push(cx.elt('MathMark', cx.lineStart + text.length - 2, cx.lineStart + text.length));
					}
				}
				const to = closed ? cx.lineStart + line.text.trimEnd().length : cx.prevLineEnd();
				if (closed) cx.nextLine();
				cx.addElement(cx.elt('MathBlock', from, to, marks));
				return true;
			},
			endLeaf: (_cx, line) => isMathOpen(line)
		},
		{
			name: 'OutlineFence',
			before: 'Blockquote',
			parse(cx: BlockContext, line: Line) {
				if (!isOutlineFence(line)) return false;
				const from = cx.lineStart + line.pos;
				const to = cx.lineStart + line.text.trimEnd().length;
				cx.addElement(cx.elt('OutlineFence', from, to, [cx.elt('OutlineMark', from, from + 3)]));
				cx.nextLine();
				return true;
			},
			// markdown-it ends a list at `:::`; CommonMark would read it as more of the last item.
			endLeaf: (_cx, line) => isOutlineFence(line)
		}
	]
};
