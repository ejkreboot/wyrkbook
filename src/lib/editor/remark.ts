/**
 * The curriculum's own Markdown ($lib/markdown) taught to remark, the parser
 * and printer behind the Milkdown editor. markdown-it stays the renderer for
 * reading and printing; this side only has to read a body into the editor
 * and write it back so that markdown-it draws the same page.
 *
 *     {{teacher note}}            → teacherNote, phrasing inside
 *     [[answer]] / [[3: answer]]  → blank, with `lines` (0 for a fill-in blank)
 *     ::: outline … :::           → outline, flow inside
 *
 * Math is remark-math's (Crepe's LaTeX feature), and ```graph fences stay
 * ordinary code blocks.
 *
 * Notes and blanks are found in the text remark leaves behind rather than by a
 * syntax extension: `{{ask **them**}}` arrives as the text "{{ask ", a strong
 * and the text "}}", and math or code spans are already their own nodes, so a
 * `}}` inside $x^{2}}$ cannot close a note — the same as markdown-it's rules,
 * which step over whole tokens.
 */

export type MdNode = {
	type: string;
	value?: string;
	children?: MdNode[];
	lines?: number;
	[key: string]: unknown;
};

/** markdown-it draws 1 to 12 lines of writing space, whatever the count says. */
export const MAX_LINES = 12;

const OPEN: Record<string, string> = { '{{': '}}', '[[': ']]' };
const MARKER = /(\{\{|\}\}|\[\[|\]\])/;

// Tagged with a symbol: Milkdown's own remark plugins put a `marker` on strong
// and emphasis nodes, so no plain property name is safe to test for.
const DELIMITER = Symbol('delimiter');
type Delimiter = { [DELIMITER]: true; marker: string };
type Item = MdNode | Delimiter;
const isMarker = (i: Item): i is Delimiter => DELIMITER in i;
const text = (value: string): MdNode => ({ type: 'text', value });

function split(children: MdNode[]): Item[] {
	const out: Item[] = [];
	for (const c of children) {
		if (c.type !== 'text' || !c.value || !MARKER.test(c.value)) {
			out.push(c);
			continue;
		}
		for (const [i, piece] of c.value.split(MARKER).entries()) {
			if (i % 2) out.push({ [DELIMITER]: true, marker: piece });
			else if (piece) out.push(text(piece));
		}
	}
	return out;
}

function merge(nodes: MdNode[]): MdNode[] {
	const out: MdNode[] = [];
	for (const n of nodes) {
		const last = out[out.length - 1];
		// Copies, not the nodes themselves: an unclosed marker has its inside read again.
		if (n.type === 'text' && last?.type === 'text') out[out.length - 1] = text((last.value ?? '') + (n.value ?? ''));
		else out.push(n);
	}
	return out;
}

/**
 * Reads items from `i` until `close` (or the end, for the top level). An
 * opener without its closer, or with nothing before it, is just text, and
 * what followed it is read again as if it weren't there.
 */
function build(items: Item[], i: number, close: string | null): { nodes: MdNode[]; i: number; closed: boolean } {
	const nodes: MdNode[] = [];
	while (i < items.length) {
		const item = items[i];
		if (!isMarker(item)) {
			nodes.push(item);
			i++;
			continue;
		}
		if (item.marker === close) return { nodes: merge(nodes), i: i + 1, closed: true };
		const closer = OPEN[item.marker];
		const inner = closer ? build(items, i + 1, closer) : null;
		if (inner?.closed && inner.nodes.length) {
			nodes.push(item.marker === '{{' ? note(inner.nodes) : blank(inner.nodes));
			i = inner.i;
		} else {
			nodes.push(text(item.marker));
			i++;
		}
	}
	return { nodes: merge(nodes), i, closed: false };
}

function note(children: MdNode[]): MdNode {
	return { type: 'teacherNote', children };
}

/** `[[3: answer]]`: the count comes off the front of the answer. */
function blank(children: MdNode[]): MdNode {
	let lines = 0;
	const first = children[0];
	const count = first?.type === 'text' ? /^\s*(\d{1,2})\s*:\s*/.exec(first.value ?? '') : null;
	if (count) {
		lines = Math.min(MAX_LINES, Math.max(1, Number(count[1])));
		first.value = first.value!.slice(count[0].length);
		if (!first.value) children = children.slice(1);
	}
	return { type: 'blank', lines, children };
}

const isFence = (n: MdNode | undefined, re: RegExp) =>
	n?.type === 'paragraph' && n.children?.length === 1 && n.children[0].type === 'text' && re.test(n.children[0].value ?? '');
const OUTLINE_OPEN = /^:::[ \t]*outline[ \t]*$/;
const OUTLINE_CLOSE = /^:::[ \t]*$/;

/** `::: outline` … `:::` paragraphs, and what lies between them, become one outline node. */
function outlines(children: MdNode[]): MdNode[] {
	const out: MdNode[] = [];
	for (let i = 0; i < children.length; i++) {
		if (!isFence(children[i], OUTLINE_OPEN)) {
			out.push(children[i]);
			continue;
		}
		// Unclosed, it runs to the end of its container — as markdown-it-container does.
		let end = i + 1;
		while (end < children.length && !isFence(children[end], OUTLINE_CLOSE)) end++;
		out.push({ type: 'outline', children: children.slice(i + 1, end) });
		i = end;
	}
	return out;
}

const OPAQUE = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html']);

function walk(node: MdNode) {
	if (!node.children || OPAQUE.has(node.type)) return;
	for (const c of node.children) walk(c);
	node.children = outlines(node.children);
	if (node.children.some((c) => c.type === 'text' && c.value && MARKER.test(c.value)))
		node.children = build(split(node.children), 0, null).nodes;
}

/** The remark plugin: a transform that runs after parsing. */
export function remarkCurriculum() {
	return (tree: MdNode) => walk(tree);
}

/*
 * Printing. The handlers follow mdast-util-to-markdown's shape; its types are
 * not a dependency of ours, so just enough of them is spelled out here.
 */
type Info = { before: string; after: string; now: { line: number; column: number }; lineShift: number };
type State = {
	enter(name: string): () => void;
	createTracker(info: Info): { move(value: string): string; current(): Info };
	containerPhrasing(parent: MdNode, info: Info): string;
	containerFlow(parent: MdNode, info: Info): string;
};
type Handle = (node: MdNode, parent: MdNode | undefined, state: State, info: Info) => string;

function wrapPhrasing(node: MdNode, state: State, info: Info, open: string, close: string, name: string) {
	const exit = state.enter(name);
	const tracker = state.createTracker(info);
	let value = tracker.move(open);
	value += tracker.move(state.containerPhrasing(node, { ...tracker.current(), before: value, after: close[0] }));
	value += tracker.move(close);
	exit();
	return value;
}

export const curriculumHandlers: Record<string, Handle> = {
	teacherNote: (node, _, state, info) => wrapPhrasing(node, state, info, '{{', '}}', 'teacherNote'),
	blank: (node, _, state, info) =>
		wrapPhrasing(node, state, info, node.lines ? `[[${node.lines}: ` : '[[', ']]', 'blank'),
	outline: (node, _, state, info) => {
		const exit = state.enter('outline');
		const tracker = state.createTracker(info);
		let value = tracker.move('::: outline\n');
		const inner = state.containerFlow(node, tracker.current());
		value += tracker.move(inner ? inner + '\n' : '');
		value += tracker.move(':::');
		exit();
		return value;
	}
};

/**
 * An empty line, as Milkdown writes one: a paragraph of just `<br />`. The
 * reader ($lib/markdown) draws it as a line of space.
 */
export const isEmptyLine = (n: MdNode) =>
	n.type === 'paragraph' &&
	n.children?.length === 1 &&
	n.children[0].type === 'html' &&
	/^<br\s*\/?\s*>$/i.test((n.children[0].value ?? '').trim());

/**
 * A blank line either side of an empty line. In a tight list Milkdown would
 * write it straight under the item's text, where Markdown reads it as more of
 * that text — `Solution:` and `<br />` on one line.
 */
export const emptyLineJoin = (left: MdNode, right: MdNode) => (isEmptyLine(left) || isEmptyLine(right) ? 1 : undefined);

/** How the editor writes Markdown: `-` bullets, as teachers and the outline generator do. */
export const stringifyOptions = { bullet: '-' as const, handlers: curriculumHandlers, join: [emptyLineJoin] };

/**
 * Rewrites the two constructs markdown-it reads and remark does not, before
 * remark sees them. Both changes are invisible on the rendered page.
 *
 * - `:::` fence lines get blank lines around them. markdown-it lets one end a
 *   paragraph or list item; to remark, `- Detail\n:::` is one paragraph.
 * - `$$` blocks get their `$$` lines to themselves. markdown-it takes
 *   `$$ x = 1 $$` on a line, or math starting on the opening line; remark-math
 *   only `$$`, the math, then `$$`.
 *
 * Fenced code is left alone.
 */
export function prepareMarkdown(src: string): string {
	const lines = (src ?? '').split('\n');
	const out: string[] = [];
	let code: { char: string; len: number } | null = null;

	const blankBefore = () => {
		if (out.length && out[out.length - 1].trim()) out.push('');
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		if (code) {
			out.push(line);
			if (fence && fence[1][0] === code.char && fence[1].length >= code.len && !trimmed.slice(fence[1].length).trim())
				code = null;
			continue;
		}
		if (fence) {
			code = { char: fence[1][0], len: fence[1].length };
			out.push(line);
			continue;
		}

		if (/^:::/.test(trimmed)) {
			blankBefore();
			out.push(line);
			if (lines[i + 1]?.trim()) out.push('');
			continue;
		}

		const indent = /^\s*/.exec(line)![0];
		if (trimmed.startsWith('$$') && indent.length < 4) {
			const math = mathBlock(lines, i, indent);
			if (math) {
				out.push(`${indent}$$`, ...math.content.split('\n').map((l) => indent + l), `${indent}$$`);
				i = math.last;
				continue;
			}
		}
		out.push(line);
	}
	return out.join('\n');
}

/** markdown-it's math block rule ($lib/markdown), read off plain lines. */
function mathBlock(lines: string[], start: number, indent: string): { content: string; last: number } | null {
	let first = lines[start].trim().slice(2);
	let last = '';
	let next = start;
	let closed = false;
	if (first.trim().endsWith('$$')) {
		first = first.trim().slice(0, -2);
		closed = true;
	}
	while (!closed) {
		next++;
		if (next >= lines.length) return null;
		const line = lines[next];
		if (line.trim() && /^\s*/.exec(line)![0].length < indent.length) return null; // dedented out of a list
		const t = line.trim();
		if (t.endsWith('$$')) {
			last = t.slice(0, -2);
			closed = true;
		}
	}
	const middle = lines.slice(start + 1, next).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()));
	const content = [first, middle.join('\n'), last].filter((s) => s.trim()).join('\n');
	return content.trim() ? { content, last: next } : null;
}
