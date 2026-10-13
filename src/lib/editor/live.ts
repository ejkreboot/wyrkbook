/**
 * The curriculum editor's live preview. The document stays the Markdown the
 * teacher wrote — every offset, save and outline region is the same text the
 * print page renders — and decorations dress it up in place: headings sized,
 * emphasis applied and its `*` hidden, notes blue, blanks underlined, math and
 * graphs drawn, outline items marked I. a. 1. by depth.
 *
 * Whatever the cursor is touching shows as source again, so editing is always
 * plain typing: inline syntax opens up when the cursor is inside it, line syntax
 * (headings, list markers, fences) when it is on the line. While math or a graph
 * is open for editing, its rendering stays underneath as a live preview. With
 * the editor unfocused, nothing is open.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { countColumn, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { renderGraph } from '$lib/graph';
import { renderInline, renderMath } from '$lib/markdown';
import { listDepth, listMarker } from './markers';
import { curriculumSyntax } from './syntax';

/* ---------------------------------------------------------------- widgets */

// Rendering is the slow part, and a cursor move rebuilds every decoration, so
// widgets render lazily (only those on screen) and remember what they made.
const rendered = new Map<string, string>();
function cached(key: string, make: () => string): string {
	let html = rendered.get(key);
	if (html === undefined) {
		if (rendered.size > 400) rendered.clear();
		rendered.set(key, (html = make()));
	}
	return html;
}

abstract class Widget extends WidgetType {
	constructor(readonly src: string) {
		super();
	}
	abstract html(): string;
	abstract tag: 'span' | 'div';
	abstract className: string;

	eq(other: WidgetType): boolean {
		return other.constructor === this.constructor && (other as Widget).src === this.src;
	}
	toDOM(view: EditorView): HTMLElement {
		const el: HTMLElement = document.createElement(this.tag);
		el.className = this.className;
		el.innerHTML = this.html();
		// A click opens the source: put the cursor at the start of what this replaced.
		el.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || !el.isConnected) return;
			e.preventDefault();
			view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
			view.focus();
		});
		return el;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

class InlineMath extends Widget {
	tag = 'span' as const;
	className = 'cm-md-math';
	html = () => cached('i' + this.src, () => renderMath(this.src, false));
}

class DisplayMath extends Widget {
	tag = 'div' as const;
	className = 'md cm-md-figure';
	html = () => cached('d' + this.src, () => `<div class="math-block">${renderMath(this.src, true)}</div>`);
}

/**
 * A `[[3: answer]]` blank as the teacher copy prints it: the answer in blue,
 * then the rest of the writing space, so the page's spacing shows while writing.
 */
class WritingSpace extends Widget {
	tag = 'span' as const;
	className = 'md cm-md-space';
	html = () => cached('w' + this.src, () => renderInline(this.src));
}

class Graph extends Widget {
	tag = 'div' as const;
	className = 'md cm-md-figure';
	html = () => cached('g' + this.src, () => renderGraph(this.src, { notes: true }));
}

/** A preview under math or a graph that is open for editing — not clickable, the source is right above. */
class Preview extends WidgetType {
	constructor(readonly inner: Widget) {
		super();
	}
	eq(other: WidgetType): boolean {
		return other instanceof Preview && this.inner.eq(other.inner);
	}
	toDOM(): HTMLElement {
		const el = document.createElement('div');
		el.className = `${this.inner.className} cm-md-preview`;
		el.innerHTML = this.inner.html();
		return el;
	}
}

class Label extends WidgetType {
	constructor(
		readonly text: string,
		readonly className: string
	) {
		super();
	}
	eq(other: WidgetType): boolean {
		return other instanceof Label && other.text === this.text && other.className === this.className;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = this.className;
		el.textContent = this.text;
		return el;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

/* ------------------------------------------------------------ focus state */

const setFocus = StateEffect.define<boolean>();
const focused = StateField.define<boolean>({
	create: () => false,
	update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setFocus) ? e.value : v), value)
});

/**
 * Keeps `focused` in step with the view. Not EditorView.focusChangeEffect: that
 * is dropped when another transaction lands first — as one does when a click on
 * a widget moves the cursor and focuses the editor in one go.
 */
const focusTracker = ViewPlugin.define((view) => {
	let queued = false;
	const sync = () => {
		queued = false;
		if (view.dom.isConnected && view.state.field(focused) !== view.hasFocus)
			view.dispatch({ effects: setFocus.of(view.hasFocus) });
	};
	const later = () => {
		if (!queued) (queued = true), setTimeout(sync);
	};
	return {
		update: (u) => {
			if (u.view.hasFocus !== u.state.field(focused)) later();
		},
		focus: later,
		blur: later
	};
}, {
	eventHandlers: {
		focus() {
			this.focus();
		},
		blur() {
			this.blur();
		}
	}
});

/* ------------------------------------------------------------ decorations */

const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });
const hide = Decoration.replace({});
const syntax = mark('cm-md-syntax');

function build(state: EditorState): DecorationSet {
	const doc = state.doc;
	const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
	const ranges = state.field(focused) ? state.selection.ranges : [];
	const out: Range<Decoration>[] = [];

	/** The cursor or selection is in or at the edge of [from, to]. */
	const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
	/** …anywhere on the lines [from, to] spans. */
	const onLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
	/** Nothing but indentation before `pos` on its line. */
	const startsLine = (pos: number) => !doc.sliceString(doc.lineAt(pos).from, pos).trim();
	const eachLine = (from: number, to: number, deco: Decoration) => {
		for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++)
			out.push(deco.range(doc.line(n).from));
	};

	/**
	 * Math blocks and graphs: drawn in place of their lines, or — while the
	 * cursor is in them — their source, with the drawing underneath.
	 */
	const figure = (node: SyntaxNode, widget: Widget, closed: boolean, cls: string) => {
		const first = doc.lineAt(node.from);
		const last = doc.lineAt(node.to);
		if (closed && !onLines(node.from, node.to)) {
			out.push(
				startsLine(node.from)
					? Decoration.replace({ widget, block: true }).range(first.from, last.to)
					: Decoration.replace({ widget }).range(node.from, node.to)
			);
			return;
		}
		eachLine(node.from, node.to, line(cls));
		if (closed) out.push(Decoration.widget({ widget: new Preview(widget), block: true, side: 1 }).range(last.to));
	};

	// Outline blocks first: list markers inside them depend on it. An opening
	// fence with no closing one runs to the end, as markdown-it-container does.
	const outlines: [number, number][] = [];
	let open = -1;
	for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
		if (n.name !== 'OutlineFence') continue;
		const isOpen = /outline/.test(doc.sliceString(n.from, n.to));
		if (isOpen && open === -1) open = n.to;
		else if (!isOpen && open !== -1) {
			outlines.push([open, n.from]);
			open = -1;
		}
	}
	if (open !== -1) outlines.push([open, doc.length + 1]);
	const inOutline = (pos: number) => outlines.some(([a, b]) => pos > a && pos < b);
	for (const [a, b] of outlines) if (b > a + 1) eachLine(a + 1, b - 1, line('cm-md-in-outline'));

	tree.iterate({
		enter(ref) {
			const n = ref.node;
			const parent = n.parent;
			switch (n.name) {
				case 'ATXHeading1':
				case 'ATXHeading2':
				case 'ATXHeading3':
				case 'ATXHeading4':
				case 'ATXHeading5':
				case 'ATXHeading6':
					out.push(line(`cm-md-h cm-md-h${n.name.slice(-1)}`).range(doc.lineAt(n.from).from));
					break;
				case 'SetextHeading1':
				case 'SetextHeading2':
					eachLine(n.from, n.to, line(`cm-md-h cm-md-h${n.name.slice(-1)}`));
					break;
				case 'HeaderMark': {
					if (!parent?.name.startsWith('ATX')) break;
					if (onLines(n.from, n.to)) {
						out.push(syntax.range(n.from, n.to));
						break;
					}
					// The space between the marks and the text goes too.
					const text = doc.sliceString(parent.from, parent.to);
					if (n.from === parent.from) {
						const gap = /^#+\s*/.exec(text)![0].length;
						out.push(hide.range(n.from, n.from + gap));
					} else {
						const gap = /\s*#+\s*$/.exec(text)?.[0].length ?? n.to - n.from;
						out.push(hide.range(parent.to - gap, n.to));
					}
					break;
				}

				case 'Emphasis':
					out.push(mark('cm-md-em').range(n.from, n.to));
					break;
				case 'StrongEmphasis':
					out.push(mark('cm-md-strong').range(n.from, n.to));
					break;
				case 'Strikethrough':
					out.push(mark('cm-md-strike').range(n.from, n.to));
					break;
				case 'InlineCode':
					out.push(mark('cm-md-code').range(n.from, n.to));
					break;
				case 'Link':
				case 'Autolink':
				case 'URL':
					out.push(mark('cm-md-link').range(n.from, n.to));
					break;
				case 'EmphasisMark':
				case 'StrikethroughMark':
				case 'NoteMark':
				case 'BlankMark':
				case 'CodeMark':
					if (!parent || parent.name === 'FencedCode') break;
					out.push((touches(parent.from, parent.to) ? syntax : hide).range(n.from, n.to));
					break;
				case 'QuoteMark':
				case 'LinkMark':
					out.push(syntax.range(n.from, n.to));
					break;

				case 'InlineMath': {
					const fence = doc.sliceString(n.from, n.from + 2) === '$$' ? 2 : 1;
					const src = doc.sliceString(n.from + fence, n.to - fence);
					if (touches(n.from, n.to)) out.push(mark('cm-md-math-src').range(n.from, n.to));
					else
						out.push(
							Decoration.replace({ widget: fence === 2 ? new DisplayMath(src) : new InlineMath(src) }).range(n.from, n.to)
						);
					return false;
				}
				case 'MathBlock': {
					const marks = n.getChildren('MathMark');
					const closed = marks.length === 2;
					const src = doc.sliceString(marks[0].to, closed ? marks[1].from : n.to);
					figure(n, new DisplayMath(src), closed, 'cm-md-math-lines');
					return false;
				}
				case 'FencedCode': {
					const info = n.getChild('CodeInfo');
					const marks = n.getChildren('CodeMark');
					if (info && doc.sliceString(info.from, info.to) === 'graph') {
						const first = doc.lineAt(n.from);
						const last = doc.lineAt(n.to);
						const indent = n.from - first.from;
						const closed = marks.length === 2 && last.number > first.number;
						const body = closed && last.number > first.number + 1 ? doc.sliceString(first.to + 1, last.from - 1) : '';
						// Dedented like markdown-it does for a fence inside a list item.
						const src = body
							.split('\n')
							.map((l) => l.replace(new RegExp(`^ {0,${indent}}`), ''))
							.join('\n');
						figure(n, new Graph(src), closed, 'cm-md-pre');
					} else {
						eachLine(n.from, n.to, line('cm-md-pre'));
					}
					return false;
				}
				case 'CodeBlock':
					eachLine(n.from, n.to, line('cm-md-pre'));
					return false;

				case 'TeacherNote':
					out.push(mark('cm-md-note').range(n.from, n.to));
					break;
				case 'Blank': {
					const marks = n.getChildren('BlankMark');
					const lines = n.getChild('BlankLines');
					if (lines && !touches(n.from, n.to)) {
						out.push(Decoration.replace({ widget: new WritingSpace(doc.sliceString(n.from, n.to)) }).range(n.from, n.to));
						return false;
					}
					const from = lines ? lines.to : marks[0].to;
					if (marks[1].from > from)
						out.push(mark(lines ? 'cm-md-write' : 'cm-md-blank').range(from, marks[1].from));
					break;
				}
				case 'BlankLines': // only reached while the blank is open; closed, it is drawn whole
					out.push(syntax.range(n.from, n.to));
					break;

				case 'OutlineFence': {
					const l = doc.lineAt(n.from);
					out.push(line('cm-md-fence').range(l.from));
					if (touches(l.from, l.to)) out.push(syntax.range(n.from, n.to));
					else {
						const open = /outline/.test(doc.sliceString(n.from, n.to));
						const text = open ? 'Outline' : 'End of outline';
						out.push(Decoration.replace({ widget: new Label(text, 'cm-md-fence-label') }).range(n.from, n.to));
					}
					return false;
				}

				case 'ListItem': {
					const listMark = n.getChild('ListMark');
					if (!listMark) break;
					const outlined = inOutline(n.from);
					const para = n.getChild('Paragraph');
					const note = para?.firstChild?.name === 'TeacherNote' && para.firstChild.from === para.from && para.firstChild.to === para.to;
					const l = doc.lineAt(listMark.from);
					const open = touches(l.from, l.to);

					// The reader's own numbering, not the typed one: markdown-it counts on from
					// the first item, so `4.` `4.` `4.` reads IV. V. VI. in an outline.
					const label = open ? null : listMarker(n, (a, b) => doc.sliceString(a, b), outlined);
					if (label !== null) {
						const cls = `cm-md-marker${outlined ? ' cm-md-omarker' : ''}${note ? ' cm-md-note' : ''}`;
						out.push(Decoration.replace({ widget: new Label(label, cls) }).range(listMark.from, listMark.to));
					} else if (note) {
						out.push(mark('cm-md-note').range(listMark.from, listMark.to));
					}
					if (outlined && listDepth(n) === 1 && para && !note) out.push(mark('cm-md-strong').range(para.from, para.to));

					// Hanging indent: a wrapped item lines up under its text, not its marker.
					const cols = countColumn(doc.sliceString(l.from, listMark.from), state.tabSize);
					const width = cols + (label ?? doc.sliceString(listMark.from, listMark.to)).length + 1;
					const style = `padding-left: calc(var(--cm-pad) + ${width}ch); text-indent: -${width}ch`;
					out.push(Decoration.line({ attributes: { style } }).range(l.from));
					break;
				}
			}
		}
	});

	return Decoration.set(out, true);
}

const decorations = StateField.define<DecorationSet>({
	create: build,
	update(deco, tr) {
		const refocused = tr.effects.some((e) => e.is(setFocus));
		if (tr.docChanged || tr.selection || refocused || syntaxTree(tr.state) !== syntaxTree(tr.startState))
			return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});

const theme = EditorView.theme({
	'&': { fontFamily: 'var(--mono)', fontSize: '.92rem' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
	'.cm-content': { padding: '1.25rem 0', caretColor: 'var(--ink)' },
	'.cm-line': { padding: '0 var(--cm-pad)' }
});

/** The live-preview Markdown language, decorations and look. */
export function livePreview(): Extension {
	return [
		markdown({ base: markdownLanguage, extensions: [curriculumSyntax] }),
		focused,
		focusTracker,
		decorations,
		EditorView.lineWrapping,
		theme
	];
}
