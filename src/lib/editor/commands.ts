/**
 * The curriculum editor's formatting actions, as CodeMirror transactions so
 * each lands on the editor's undo stack as one step.
 */
import { indentLess, indentMore } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';

/** Wraps each selection inline, e.g. **bold** or $math$, leaving its text selected. */
export function wrap(view: EditorView, before: string, after: string, placeholder: string) {
	const { state } = view;
	view.dispatch(
		state.changeByRange((r) => {
			const text = state.sliceDoc(r.from, r.to) || placeholder;
			const from = r.from + before.length;
			return {
				changes: { from: r.from, to: r.to, insert: before + text + after },
				range: EditorSelection.range(from, from + text.length)
			};
		}),
		{ scrollIntoView: true, userEvent: 'input' }
	);
	view.focus();
}

/** Wraps the selection in a fenced block on lines of its own, blank line either side. */
export function fence(view: EditorView, open: string, close: string, placeholder: string) {
	const { state } = view;
	const { from, to } = state.selection.main;
	const before = state.sliceDoc(0, from);
	const after = state.sliceDoc(to);
	const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
	const post = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
	const text = state.sliceDoc(from, to).replace(/^\n+|\n+$/g, '') || placeholder;
	const head = `${pre}${open}\n`;
	view.dispatch({
		changes: { from, to, insert: `${head}${text}\n${close}${post}` },
		selection: EditorSelection.range(from + head.length, from + head.length + text.length),
		scrollIntoView: true,
		userEvent: 'input'
	});
	view.focus();
}

/** Puts a prefix at the start of every selected line — headings and lists. */
export function prefixLines(view: EditorView, prefix: string) {
	const { state } = view;
	const { from, to } = state.selection.main;
	const first = state.doc.lineAt(from);
	// A selection ending at the start of a line doesn't include that line.
	const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
	const changes = state.changes(
		Array.from({ length: last.number - first.number + 1 }, (_, i) => ({
			from: state.doc.line(first.number + i).from,
			insert: prefix
		}))
	);
	view.dispatch({
		changes,
		selection: EditorSelection.range(first.from + prefix.length, changes.mapPos(last.to)),
		scrollIntoView: true,
		userEvent: 'input'
	});
	view.focus();
}

/**
 * ⌘B / ⌘I, and Tab / Shift-Tab moving the selected lines one outline level in
 * or out (by the four-space indent unit, which nests under `1. ` and `10. `
 * alike). Esc then Tab still leaves the editor — CodeMirror's tab-focus mode.
 */
export const formattingKeymap = keymap.of([
	{ key: 'Mod-b', run: (v) => (wrap(v, '**', '**', 'bold'), true) },
	{ key: 'Mod-i', run: (v) => (wrap(v, '*', '*', 'italic'), true) },
	{ key: 'Tab', run: indentMore, shift: indentLess }
]);
