/**
 * The curriculum editor: Milkdown's Crepe, plus the curriculum's own Markdown
 * ($lib/editor/remark) as ProseMirror marks and nodes.
 *
 *     teacher_note   mark    {{…}}        blue; absent from handouts
 *     blank          mark    [[…]]        a fill-in blank
 *     outline        node    ::: outline  lists inside marked I. a. 1. by depth
 *
 * Math is Crepe's LaTeX feature (KaTeX); a ```graph fence is a code block whose
 * preview is drawn by $lib/graph, as the reader draws it.
 *
 * Space to write in is empty lines, typed and deleted like any other line. A
 * writing space in the Markdown (`[[n: answer]]`, as imports and generated
 * outlines have it) is read in as its answer in a teacher note and n empty
 * lines below (remarkSpacesAsLines), and written back out that way.
 *
 * In an outline, Enter on an empty item, or on an empty line under one, adds
 * an empty line rather than splitting the list (outlineSpace).
 */
import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import {
	commandsCtx,
	type CmdKey,
	editorViewCtx,
	editorViewOptionsCtx,
	parserCtx,
	remarkStringifyOptionsCtx,
	serializerCtx
} from '@milkdown/kit/core';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import {
	bulletListSchema,
	clearTextInCurrentBlockCommand,
	codeBlockSchema,
	isMarkSelectedCommand,
	listItemSchema,
	paragraphSchema
} from '@milkdown/kit/preset/commonmark';
import { markRule } from '@milkdown/kit/prose';
import { toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import { Slice, type Mark, type MarkType, type Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { $command, $inputRule, $markSchema, $nodeSchema, $prose, $remark, $shortcut } from '@milkdown/kit/utils';
import { renderGraph } from '$lib/graph';
import { curriculumHandlers, emptyLineJoin, prepareMarkdown, remarkCurriculum, remarkSpacesAsLines } from './remark';

/** Holds a place for an empty answer: a mark needs text, and a plain space would be trimmed off. */
const EMPTY_ANSWER = ' ';

const curriculumRemark = $remark('curriculum', () => remarkCurriculum as never);
const spacesRemark = $remark('spacesAsLines', () => remarkSpacesAsLines as never);

export const teacherNoteSchema = $markSchema('teacher_note', () => ({
	parseDOM: [{ tag: 'span.teacher-note' }],
	toDOM: () => ['span', { class: 'teacher-note', title: 'Teacher note — not on handouts' }, 0],
	parseMarkdown: {
		match: (node) => node.type === 'teacherNote',
		runner: (state, node, type) => {
			state.openMark(type);
			state.next(node.children);
			state.closeMark(type);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === 'teacher_note',
		runner: (state, mark) => {
			state.withMark(mark, 'teacherNote');
		}
	}
}));

export const blankSchema = $markSchema('blank', () => ({
	// Text typed just after a blank is not its answer; blankTyping keeps an answer being typed in.
	inclusive: false,
	// A writing space pasted from the reader comes in as a fill-in blank: space here is empty lines.
	parseDOM: [{ tag: 'span.blank' }, { tag: 'span.write' }],
	toDOM: () => ['span', { class: 'blank' }, 0],
	parseMarkdown: {
		match: (node) => node.type === 'blank',
		runner: (state, node, type) => {
			state.openMark(type);
			if (node.children?.length) state.next(node.children);
			else state.addText(EMPTY_ANSWER);
			state.closeMark(type);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === 'blank',
		runner: (state, mark) => {
			state.withMark(mark, 'blank');
		}
	}
}));

export const outlineSchema = $nodeSchema('outline', () => ({
	content: 'block+',
	group: 'block',
	defining: true,
	parseDOM: [{ tag: 'div.outline' }],
	toDOM: () => ['div', { class: 'outline' }, 0],
	parseMarkdown: {
		match: (node) => node.type === 'outline',
		runner: (state, node, type) => {
			state.openNode(type);
			state.next(node.children);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'outline',
		runner: (state, node) => {
			state.openNode('outline');
			state.next(node.content);
			state.closeNode();
		}
	}
}));

/**
 * New list items are tight, like the ones teachers type. Milkdown makes them
 * loose (`spread`), which writes a blank line after each and spaces the reader's
 * list out. Items read from Markdown keep whatever they had.
 */
const tightListItemSchema = listItemSchema.extendSchema((prev) => (ctx) => {
	const base = prev(ctx);
	return { ...base, attrs: { ...base.attrs, spread: { default: false, validate: 'boolean' } } };
});

/** Typing `{{note}}` or `[[answer]]` in full turns it into one. */
const noteInputRule = $inputRule((ctx) => markRule(/\{\{([^{}]+)\}\}$/, teacherNoteSchema.type(ctx)));
const blankInputRule = $inputRule((ctx) => markRule(/\[\[([^[\]]+)\]\]$/, blankSchema.type(ctx)));

/** The stretch of `type` around an empty selection, inside its textblock. */
function markAround(state: EditorState, type: MarkType) {
	const { $from, empty } = state.selection;
	if (!empty) return null;
	const mark = type.isInSet($from.nodeAfter?.marks ?? []) ?? type.isInSet($from.nodeBefore?.marks ?? []);
	if (!mark) return null;

	const parent = $from.parent;
	const base = $from.start();
	let from = -1;
	let to = -1;
	let pos = base;
	let found = false;
	parent.forEach((child: PMNode) => {
		const end = pos + child.nodeSize;
		if (mark.isInSet(child.marks)) {
			if (from === -1 || to !== pos) from = pos;
			to = end;
			if (from <= $from.pos && $from.pos <= to) found = true;
		} else if (!found) {
			from = to = -1;
		}
		pos = end;
	});
	return found ? { mark, from, to } : null;
}

/**
 * Marks the selection, or — with nothing selected — unmarks the stretch the
 * cursor is in, or puts in `placeholder` marked and selected, ready to type over.
 */
function markCommand(type: MarkType, placeholder: string): Command {
	return (state, dispatch) => {
		if (!state.selection.empty) return toggleMark(type)(state, dispatch);
		const around = markAround(state, type);
		if (around) {
			dispatch?.(state.tr.removeMark(around.from, around.to, type));
			return true;
		}
		if (dispatch) {
			const { from } = state.selection;
			const tr = state.tr.insertText(placeholder, from);
			tr.addMark(from, from + placeholder.length, type.create());
			tr.setSelection(TextSelection.create(tr.doc, from, from + placeholder.length));
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

export const toggleTeacherNoteCommand = $command(
	'ToggleTeacherNote',
	(ctx) => () => markCommand(teacherNoteSchema.type(ctx), 'remind myself to…')
);
export const toggleBlankCommand = $command('ToggleBlank', (ctx) => () => markCommand(blankSchema.type(ctx), 'answer'));

/**
 * A blank ends where its answer does: the cursor just after one types outside
 * it, as just after a link. Except while the answer is being written — typed
 * over the placeholder, typed on from inside, or the cursor moved to its end
 * from within — when the cursor is on the inside of that end, and what is
 * typed goes into the answer. The plugin's state is that position, or null.
 */
const blankTypingKey = new PluginKey<number | null>('blankTyping');

const blankTyping = $prose((ctx) => {
	const type = blankSchema.type(ctx);
	const blankAt = (state: EditorState, pos: number) => {
		const $pos = state.doc.resolve(pos);
		return { before: type.isInSet($pos.nodeBefore?.marks ?? []), after: type.isInSet($pos.nodeAfter?.marks ?? []) };
	};
	return new Plugin<number | null>({
		key: blankTypingKey,
		state: {
			init: () => null,
			apply: (tr, value, old, state) => {
				const meta = tr.getMeta(blankTypingKey);
				if (meta !== undefined) return meta;
				const { empty, head } = state.selection;
				if (!empty) return null;
				const here = blankAt(state, head);
				if (!here.before || here.after?.eq(here.before)) return null; // not at the end of a blank
				const from = old.selection.head;
				// Still there: after a Backspace, or a selection update that didn't move the cursor.
				if (value !== null && tr.mapping.map(value, -1) === head && (tr.docChanged || from === head)) return head;
				// Moved right to the end from inside the same blank (quick key presses can arrive as one move).
				if (tr.docChanged || from >= head) return null;
				const mark = here.before;
				const was = blankAt(old, from);
				if (!was.before?.eq(mark) || !was.after?.eq(mark)) return null;
				let same = true;
				state.doc.nodesBetween(from, head, (node) => {
					if (node.isInline && !mark.isInSet(node.marks)) same = false;
				});
				return same ? head : null;
			}
		},
		props: {
			// → or End on the inside of an answer's end steps out of it, the cursor staying put.
			handleKeyDown: (view, event) => {
				if ((event.key !== 'ArrowRight' && event.key !== 'End') || event.shiftKey || event.metaKey || event.altKey || event.ctrlKey)
					return false;
				const at = blankTypingKey.getState(view.state);
				const { $head } = view.state.selection;
				if (at === null || at !== $head.pos) return false;
				// End only where it couldn't move on anyway: the answer ends the paragraph.
				if (event.key === 'End' && $head.parentOffset !== $head.parent.content.size) return false;
				view.dispatch(view.state.tr.setMeta(blankTypingKey, null));
				return true;
			},
			handleTextInput: (view, from, to, text) => {
				const { state } = view;
				let mark: Mark | undefined;
				if (from < to) {
					// Typing over all or part of an answer (marksAcross would drop a mark ending at `to`).
					const over = blankAt(state, from).after;
					let whole = !!over;
					state.doc.nodesBetween(from, to, (node) => {
						if (node.isInline && !over?.isInSet(node.marks)) whole = false;
					});
					if (whole) mark = over;
				} else if (blankTypingKey.getState(state) === from) mark = blankAt(state, from).before;
				if (!mark) return false;
				const tr = state.tr.insertText(text, from, to);
				tr.addMark(from, from + text.length, mark);
				view.dispatch(tr.setMeta(blankTypingKey, from + text.length).scrollIntoView());
				return true;
			}
		}
	});
});

/**
 * Enter in an outline, where a list would split or lift the item and restart
 * the numbering after it (Shift-Tab still lifts):
 *
 * - on an empty item that follows another, an empty line goes in at the end of
 *   the item before, and the cursor stays on the empty item — so each Enter
 *   adds a line of space, and typing writes the next point;
 * - on one of those empty lines, another goes in below it, and the cursor
 *   moves down onto it.
 */
const outlineSpace: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
	const item = $from.node(-1);
	if (item?.type.name !== 'list_item') return false;
	let inOutline = false;
	for (let d = $from.depth - 2; d > 0 && !inOutline; d--) inOutline = $from.node(d).type.name === 'outline';
	if (!inOutline) return false;
	const line = state.schema.nodes.paragraph.create();

	// On an empty line under a point: another line below it, the cursor moving down onto it.
	if ($from.index(-1) > 0) {
		if (dispatch) {
			const at = $from.after();
			const tr = state.tr.insert(at, line);
			dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
		}
		return true;
	}

	// On an empty point after another: a line at the end of the point before, just inside its closing.
	if (item.childCount !== 1 || $from.index(-2) === 0) return false;
	if (dispatch) dispatch(state.tr.insert($from.before(-1) - 1, line).scrollIntoView());
	return true;
};

const outlineKeymap = $shortcut(() => ({
	OutlineSpace: { key: 'Enter', priority: 100, onRun: () => outlineSpace }
}));

/** Puts `node` in place of an empty paragraph at the cursor, or after the block it is in. */
function insertBlock(state: EditorState, node: PMNode, dispatch?: (tr: Transaction) => void) {
	const { $from } = state.selection;
	const empty = $from.parent.isTextblock && $from.parent.content.size === 0;
	const at = empty ? $from.before() : $from.after();
	const tr = empty ? state.tr.replaceWith(at, $from.after(), node) : state.tr.insert(at, node);
	if (dispatch) dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView());
	return true;
}

/** Wraps the selected blocks in an outline, or starts a new one with an empty point. */
export const insertOutlineCommand = $command('InsertOutline', (ctx) => () => (state, dispatch) => {
	const outline = outlineSchema.type(ctx);
	const { $from, empty } = state.selection;
	if (!empty || $from.parent.content.size) return wrapIn(outline)(state, dispatch);
	const point = listItemSchema.type(ctx).create(null, paragraphSchema.type(ctx).create());
	return insertBlock(state, outline.create(null, bulletListSchema.type(ctx).create(null, point)), dispatch);
});

const GRAPH_SAMPLE = 'x: -5..5\ny: -5..5\ny = x^2 - 3\n[[point (0, -3) "vertex"]]';

export const insertGraphCommand = $command('InsertGraph', (ctx) => () => (state, dispatch) => {
	const node = codeBlockSchema.type(ctx).create({ language: 'graph' }, state.schema.text(GRAPH_SAMPLE));
	return insertBlock(state, node, dispatch);
});

/* Icons for Crepe's menus, in its 24px Material style. Each carries its own
   tooltip, as the top bar shows icons with no labels. */
const svg = (title: string, path: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960" fill="currentColor"><title>${title}</title><path d="${path}"/></svg>`;
const noteIcon = svg(
	'Teacher note — hidden on handouts',
	'M200-200h360v-200h200v-360H200v560Zm0 80q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v400L600-120H200Zm80-280v-80h200v80H280Zm0-160v-80h400v80H280Zm-80 360v-560 560Z'
);
const blankIcon = svg('Fill-in blank — the answer is hidden on handouts. → at the end of an answer steps out of it', 'M160-200v-80h640v80H160Z');
const outlineIcon = svg(
	'Outline — lists inside are numbered I. a. 1. by depth',
	'M120-120v-80h720v80H120Zm280-160v-80h440v80H400Zm0-160v-80h440v80H400Zm-160-160v-80h600v80H240ZM120-760v-80h720v80H120Z'
);
const graphIcon = svg(
	'Graph — a coordinate plane or number line',
	'M120-120v-720h80v640h640v80H120Zm120-120v-280h120v280H240Zm200 0v-480h120v480H440Zm200 0v-160h120v160H640Z'
);

/** Whether the selection is in `type`, or — with nothing selected — the cursor is. */
function markActive(ctx: Ctx, type: MarkType) {
	const { state } = ctx.get(editorViewCtx);
	if (ctx.get(commandsCtx).call(isMarkSelectedCommand.key, type)) return true;
	const { $cursor } = state.selection as TextSelection;
	return !!$cursor && type.isInSet(state.storedMarks ?? $cursor.marks()) !== undefined;
}

/** Markdown in, and how the editor would write it back out — without touching what is on screen. */
export function normalizer(ctx: Ctx) {
	return (markdown: string) => ctx.get(serializerCtx)(ctx.get(parserCtx)(prepareMarkdown(markdown)));
}

/**
 * Where Crepe's block handle (+ and drag grip) sits: level with the block's
 * first line, and in the margin left of the text column whatever the block —
 * by default it hugs a list item, covering the number hanging to its left.
 */
function handleOffset({ active, editorDom, blockDom }: { active: { el: HTMLElement }; editorDom: HTMLElement; blockDom: HTMLElement }) {
	const el = active.el;
	const column = editorDom.getBoundingClientRect().left + (Number.parseFloat(getComputedStyle(editorDom).paddingLeft) || 0);
	const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
	const handleHeight = blockDom.getBoundingClientRect().height;
	return {
		mainAxis: 12 + Math.max(0, el.getBoundingClientRect().left - column),
		crossAxis: Number.isFinite(lineHeight) && handleHeight ? (lineHeight - handleHeight) / 2 : 0
	};
}

/**
 * Builds the editor in `root`. `onchange` hears every change to the document,
 * as it happens — Milkdown's own listener waits 200ms, long enough for a ⌘S
 * to save the text from before the last keystrokes.
 */
export async function createEditor(
	root: HTMLElement,
	markdown: string,
	placeholder: string,
	onchange: (markdown: string) => void
): Promise<Crepe> {
	const crepe = new Crepe({
		root,
		defaultValue: prepareMarkdown(markdown),
		features: {
			// Lists keep plain <ul>/<ol> so outlines can number them I. a. 1. as the reader does.
			[Crepe.Feature.ListItem]: false,
			// Images would need somewhere to upload to; Markdown images still show.
			[Crepe.Feature.ImageBlock]: false,
			// A toolbar always on show above the document, in place of the one that pops up over a selection.
			[Crepe.Feature.TopBar]: true,
			[Crepe.Feature.Toolbar]: false
		},
		featureConfigs: {
			[Crepe.Feature.Placeholder]: { text: placeholder, mode: 'doc' },
			[Crepe.Feature.Latex]: { katexOptions: { throwOnError: false, strict: 'ignore' } },
			[Crepe.Feature.TopBar]: {
				buildTopBar: (builder) => {
					// Task lists: markdown-it would print their [ ] as text.
					const list = builder.getGroup('list').group;
					list.items = list.items.filter((item) => item.key !== 'task-list');
					builder
						.addGroup('curriculum', 'Curriculum')
						.addItem('teacher-note', {
							icon: noteIcon,
							active: (ctx: Ctx) => markActive(ctx, teacherNoteSchema.type(ctx)),
							onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(toggleTeacherNoteCommand.key)
						})
						.addItem('blank', {
							icon: blankIcon,
							active: (ctx: Ctx) => markActive(ctx, blankSchema.type(ctx)),
							onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(toggleBlankCommand.key)
						})
						.addItem('outline', {
							icon: outlineIcon,
							active: () => false,
							onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(insertOutlineCommand.key)
						})
						.addItem('graph', {
							icon: graphIcon,
							active: () => false,
							onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(insertGraphCommand.key)
						});
				}
			},
			[Crepe.Feature.BlockEdit]: {
				blockHandle: { getPlacement: () => 'left-start', getOffset: handleOffset },
				buildMenu: (builder) => {
					const run = (ctx: Ctx, key: CmdKey<unknown>) => {
						ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
						ctx.get(commandsCtx).call(key);
					};
					builder
						.addGroup('curriculum', 'Curriculum')
						.addItem('outline', { label: 'Outline', icon: outlineIcon, onRun: (ctx: Ctx) => run(ctx, insertOutlineCommand.key) })
						.addItem('graph', { label: 'Graph', icon: graphIcon, onRun: (ctx: Ctx) => run(ctx, insertGraphCommand.key) })
						.addItem('teacher-note', {
							label: 'Teacher note',
							icon: noteIcon,
							onRun: (ctx: Ctx) => run(ctx, toggleTeacherNoteCommand.key)
						})
						.addItem('blank', { label: 'Blank', icon: blankIcon, onRun: (ctx: Ctx) => run(ctx, toggleBlankCommand.key) });
				}
			}
		}
	});

	crepe.editor
		.config((ctx) => {
			// The reader's class, so notes, blanks and outlines look as they will on the page.
			ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: { class: 'md', spellcheck: 'true' } }));
			// A pasted image would be kept as a blob: URL, gone once the page closes.
			ctx.update(uploadConfig.key, (prev) => ({ ...prev, uploader: async () => [] }));
			ctx.update(remarkStringifyOptionsCtx, (prev) => ({
				...prev,
				bullet: '-' as const,
				handlers: { ...prev.handlers, ...(curriculumHandlers as unknown as typeof prev.handlers) },
				join: [...(prev.join ?? []), emptyLineJoin as unknown as NonNullable<typeof prev.join>[number]]
			}));
			ctx.update(codeBlockConfig.key, (prev) => ({
				...prev,
				renderPreview: (language, content, apply) =>
					language.toLowerCase() === 'graph' && content.trim()
						? renderGraph(content, { notes: true })
						: prev.renderPreview(language, content, apply)
			}));
		})
		.use(
			$prose(
				(ctx) =>
					new Plugin({
						view: () => ({
							update: (view, prev) => {
								if (!view.state.doc.eq(prev.doc)) onchange(ctx.get(serializerCtx)(view.state.doc));
							}
						})
					})
			)
		)
		.use(curriculumRemark)
		.use(spacesRemark)
		.use(tightListItemSchema)
		.use(teacherNoteSchema)
		.use(blankSchema)
		.use(outlineSchema)
		.use(noteInputRule)
		.use(blankInputRule)
		.use(blankTyping)
		.use(outlineKeymap)
		.use(toggleTeacherNoteCommand)
		.use(toggleBlankCommand)
		.use(insertOutlineCommand)
		.use(insertGraphCommand);

	await crepe.create();
	return crepe;
}

/** Puts `markdown` in place of the whole document, as one step that undo skips over. */
export function replaceDoc(crepe: Crepe, markdown: string) {
	crepe.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const doc = ctx.get(parserCtx)(prepareMarkdown(markdown));
		const { state } = view;
		view.dispatch(
			state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)).setMeta('addToHistory', false)
		);
	});
}
