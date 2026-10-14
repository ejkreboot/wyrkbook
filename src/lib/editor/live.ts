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
 * the editor unfocused, nothing is open — and while the mouse button is down,
 * nothing opens or closes: a click or drag works on the page as it was when it
 * started.
 *
 * Writing spaces never open: their answer is typed in place and their size
 * changed with Enter and Backspace, as $lib/editor/space describes.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { countColumn, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { renderGraph } from '$lib/graph';
import { renderMath } from '$lib/markdown';
import { listDepth, listMarker } from './markers';
import { writingSpace, writingSpaceKeymap } from './space';
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

	/** Where a click puts the cursor, given where the widget sits: by default the start of what it replaced. */
	anchor(pos: number): number {
		return pos;
	}

	eq(other: WidgetType): boolean {
		return other.constructor === this.constructor && (other as Widget).src === this.src;
	}
	toDOM(view: EditorView): HTMLElement {
		const el: HTMLElement = document.createElement(this.tag);
		el.className = this.className;
		el.innerHTML = this.html();
		// A click opens the source.
		el.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || !el.isConnected) return;
			e.preventDefault();
			view.dispatch({ selection: { anchor: this.anchor(view.posAtDOM(el)) } });
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
 * A writing space as the teacher copy prints it, around the answer the teacher
 * types: SpaceStart stands in for the `[[3: ` and starts the space on a line of
 * its own; SpaceRest stands in for the `]]` and is the room left below the answer.
 */
class SpaceStart extends WidgetType {
	eq(other: WidgetType): boolean {
		return other instanceof SpaceStart;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'cm-md-space-start';
		return el;
	}
}

/** `src` is the line count. A click puts the cursor at the end of the answer, just before it. */
class SpaceRest extends Widget {
	tag = 'span' as const;
	className = 'cm-md-space-rest';
	html = () => '';
	toDOM(view: EditorView): HTMLElement {
		const el = super.toDOM(view);
		el.style.setProperty('--lines', this.src);
		return el;
	}
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

/* ---------------------------------------------------------- pointer state */

const setPointer = StateEffect.define<boolean>();
/** The mouse button is down in the editor. */
const pointer = StateField.define<boolean>({
	create: () => false,
	update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setPointer) ? e.value : v), value)
});

/**
 * Raises `pointer` on mousedown and drops it once the button is up — after
 * CodeMirror's own mouseup, which sets the final selection from the page as the
 * drag saw it. A text drag-and-drop never sends a mouseup; the next buttonless
 * mousemove ends it instead.
 */
const pointerTracker = EditorView.domEventHandlers({
	mousedown(e, view) {
		if (e.button !== 0) return false;
		view.dispatch({ effects: setPointer.of(true) });
		const win = view.dom.ownerDocument.defaultView ?? window;
		const up = () => {
			win.removeEventListener('mouseup', up);
			win.removeEventListener('mousemove', move);
			if (view.dom.isConnected && view.state.field(pointer)) view.dispatch({ effects: setPointer.of(false) });
		};
		const move = (m: MouseEvent) => {
			if (!(m.buttons & 1)) up();
		};
		win.addEventListener('mouseup', up);
		win.addEventListener('mousemove', move);
		return false;
	}
});

/* ------------------------------------------------------------ decorations */

const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });
const hide = Decoration.replace({});
const syntax = mark('cm-md-syntax');

/** The decorations, and the hidden stretches the cursor must step over whole. */
interface Built {
	deco: DecorationSet;
	atoms: DecorationSet;
}

function build(state: EditorState): Built {
	const doc = state.doc;
	const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
	const ranges = state.field(focused) ? state.selection.ranges : [];
	const out: Range<Decoration>[] = [];
	const atoms: Range<Decoration>[] = [];

	/** The cursor or selection is in or at the edge of [from, to]. */
	const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
	/** …anywhere on the lines [from, to] spans. */
	const onLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
	/** The cursor or an end of a selection is on those lines — a selection just passing over them doesn't count. */
	const endsOnLines = (from: number, to: number) => {
		const [a, b] = [doc.lineAt(from).from, doc.lineAt(to).to];
		return ranges.some((r) => (r.anchor >= a && r.anchor <= b) || (r.head >= a && r.head <= b));
	};
	/** Nothing but indentation before `pos` on its line. */
	const startsLine = (pos: number) => !doc.sliceString(doc.lineAt(pos).from, pos).trim();
	const eachLine = (from: number, to: number, deco: Decoration) => {
		for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++)
			out.push(deco.range(doc.line(n).from));
	};

	/**
	 * Math blocks and graphs: drawn in place of their lines, or — while the
	 * cursor is in them — their source, with the drawing underneath. Selecting
	 * across one leaves it drawn; opening it would push the selection's end away.
	 */
	const figure = (node: SyntaxNode, widget: Widget, closed: boolean, cls: string) => {
		const first = doc.lineAt(node.from);
		const last = doc.lineAt(node.to);
		if (closed && !endsOnLines(node.from, node.to)) {
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
					if (!parent || parent.name === 'FencedCode' || parent.getChild('BlankLines')) break;
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
					const space = writingSpace(doc, n);
					if (space) {
						const start = Decoration.replace({ widget: new SpaceStart() }).range(space.from, space.start);
						const rest = Decoration.replace({ widget: new SpaceRest(String(space.lines)) }).range(space.end, space.to);
						out.push(start, rest);
						atoms.push(start, rest);
						if (space.end > space.start) out.push(mark('cm-md-write').range(space.start, space.end));
						break; // on into the answer, for its own emphasis and math
					}
					const marks = n.getChildren('BlankMark');
					if (marks[1].from > marks[0].to) out.push(mark('cm-md-blank').range(marks[0].to, marks[1].from));
					break;
				}

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

	return { deco: Decoration.set(out, true), atoms: Decoration.set(atoms, true) };
}

const decorations = StateField.define<Built>({
	create: build,
	update(deco, tr) {
		// Held still under the mouse: a drag that opened what it passed over would
		// move the text out from under the pointer and select something else.
		if (tr.state.field(pointer) && !tr.docChanged) return deco;
		const settled = tr.effects.some((e) => e.is(setFocus) || e.is(setPointer));
		if (tr.docChanged || tr.selection || settled || syntaxTree(tr.state) !== syntaxTree(tr.startState))
			return build(tr.state);
		return deco;
	},
	provide: (f) => [EditorView.decorations.from(f, (b) => b.deco), EditorView.atomicRanges.from(f, (b) => () => b.atoms)]
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
		pointer,
		pointerTracker,
		decorations,
		writingSpaceKeymap,
		EditorView.lineWrapping,
		theme
	];
}
