/**
 * Writing spaces — `[[3: answer]]`, three lines of room to write — edited as
 * space rather than as syntax. The live editor ($lib/editor/live) never shows
 * the `[[3:` and `]]`: the answer is typed in place, and these keys keep the
 * count behind the scenes.
 *
 *     Enter        in the answer: one more line of space. In a fill-in
 *                  blank, makes it a one-line writing space.
 *     Backspace    at the start of the answer, or just after the space: one line fewer.
 *     Delete       at the end of the answer, or just before the space: one line fewer.
 *
 * Taking the last line from an empty space removes it; from one with an answer
 * in it, the line stays and the cursor steps into the answer instead.
 */
import { syntaxTree } from '@codemirror/language';
import { Prec, type EditorState, type StateCommand, type Text, type Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** markdown-it draws 1 to 12 lines, whatever the count says. */
export const MAX_LINES = 12;

export interface Space {
	/** The whole `[[3: answer]]`. */
	from: number;
	to: number;
	/** Where the count is written, and what it says (clamped as drawn). */
	count: { from: number; to: number };
	lines: number;
	/** The answer, without the spaces after the `:`. */
	start: number;
	end: number;
}

/** A Blank node's parts if it is a writing space, or null for a fill-in blank. */
export function writingSpace(doc: Text, node: SyntaxNode): Space | null {
	const lines = node.getChild('BlankLines');
	const close = node.getChildren('BlankMark')[1];
	if (!lines || !close) return null;
	const digits = /\d+/.exec(doc.sliceString(lines.from, lines.to))!;
	const lead = /^\s*/.exec(doc.sliceString(lines.to, close.from))![0].length;
	return {
		from: node.from,
		to: node.to,
		count: { from: lines.from + digits.index, to: lines.from + digits.index + digits[0].length },
		lines: Math.min(MAX_LINES, Math.max(1, Number(digits[0]))),
		start: lines.to + lead,
		end: close.from
	};
}

/** The blanks at `pos`, including one ending or starting there. */
function blanksAt(state: EditorState, pos: number): SyntaxNode[] {
	const found: SyntaxNode[] = [];
	for (const side of [-1, 1] as const)
		for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent)
			if (n.name === 'Blank' && !found.some((f) => f.from === n!.from)) found.push(n);
	return found;
}

/** The lone cursor, or null for a selection or several cursors. */
function cursor(state: EditorState): number | null {
	const r = state.selection.main;
	return state.selection.ranges.length === 1 && r.empty ? r.head : null;
}

/** The change that rewrites the count. */
const resize = (space: Space, lines: number) => ({ ...space.count, insert: String(lines) });

/**
 * One line fewer. On the last line an empty space goes; one with an answer
 * stays, and the cursor moves to `fallback`. Always handled — the default
 * would delete the hidden syntax.
 */
function shrink(state: EditorState, dispatch: (tr: Transaction) => void, space: Space, fallback: number) {
	if (space.lines > 1) dispatch(state.update({ changes: resize(space, space.lines - 1), userEvent: 'delete', scrollIntoView: true }));
	else if (space.start === space.end) dispatch(state.update({ changes: { from: space.from, to: space.to }, userEvent: 'delete' }));
	else if (cursor(state) !== fallback) dispatch(state.update({ selection: { anchor: fallback }, scrollIntoView: true }));
	return true;
}

export const addLine: StateCommand = ({ state, dispatch }) => {
	const pos = cursor(state);
	if (pos === null) return false;
	for (const node of blanksAt(state, pos)) {
		const space = writingSpace(state.doc, node);
		if (space) {
			if (pos < space.start || pos > space.end) continue;
			if (space.lines < MAX_LINES)
				dispatch(state.update({ changes: resize(space, space.lines + 1), userEvent: 'input', scrollIntoView: true }));
			return true;
		}
		const [open, close] = node.getChildren('BlankMark');
		if (close && pos >= open.to && pos <= close.from) {
			dispatch(
				state.update({ changes: { from: open.to, insert: '1: ' }, selection: { anchor: pos + 3 }, userEvent: 'input', scrollIntoView: true })
			);
			return true;
		}
	}
	return false;
};

export const removeLineBefore: StateCommand = ({ state, dispatch }) => {
	const pos = cursor(state);
	if (pos === null) return false;
	for (const node of blanksAt(state, pos)) {
		const space = writingSpace(state.doc, node);
		if (space && pos === space.start) return shrink(state, dispatch, space, space.start);
		if (space && pos === space.to) return shrink(state, dispatch, space, space.end);
	}
	return false;
};

export const removeLineAfter: StateCommand = ({ state, dispatch }) => {
	const pos = cursor(state);
	if (pos === null) return false;
	for (const node of blanksAt(state, pos)) {
		const space = writingSpace(state.doc, node);
		if (space && pos === space.end) return shrink(state, dispatch, space, space.end);
		if (space && pos === space.from) return shrink(state, dispatch, space, space.start);
	}
	return false;
};

/** Ahead of the default Enter and Backspace, which would split or eat the hidden syntax. */
export const writingSpaceKeymap = Prec.high(
	keymap.of([
		{ key: 'Enter', run: addLine },
		{ key: 'Backspace', run: removeLineBefore },
		{ key: 'Delete', run: removeLineAfter }
	])
);
