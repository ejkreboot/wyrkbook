/**
 * Inline math keeps the marks of the text it takes the place of. Crepe's rule
 * for typing `$x^2$` puts the math in with no marks, so math typed in a
 * teacher note split the note around it — and, outside the note, went on the
 * handout. In a module of its own, without the editor, so it can be tested.
 */
import type { Mark, Node as PMNode } from '@milkdown/kit/prose/model';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { ReplaceStep } from '@milkdown/kit/prose/transform';

/** The marks every inline node in [from, to) has. */
export function sharedMarks(doc: PMNode, from: number, to: number): readonly Mark[] {
	let marks: readonly Mark[] | null = null;
	doc.nodesBetween(from, to, (node) => {
		if (!node.isInline) return true;
		marks = marks === null ? node.marks : marks.filter((m) => m.isInSet(node.marks));
		return false;
	});
	return marks ?? [];
}

/**
 * An appendTransaction: for each change that put one math_inline in place of
 * some text, gives the math the marks all that text had.
 */
export function keepMathMarks(trs: readonly Transaction[], _old: EditorState, state: EditorState): Transaction | null {
	const fix = state.tr;
	trs.forEach((t, i) => {
		const step = t.steps.length === 1 ? t.steps[0] : null;
		if (!(step instanceof ReplaceStep) || step.from === step.to) return;
		const node = step.slice.content.childCount === 1 ? step.slice.content.firstChild : null;
		if (node?.type.name !== 'math_inline') return;
		const marks = sharedMarks(t.before, step.from, step.to).filter((m) => !m.isInSet(node.marks));
		if (!marks.length) return;
		const at = trs.slice(i + 1).reduce((pos, later) => later.mapping.map(pos), step.from);
		for (const mark of marks) fix.addMark(at, at + 1, mark);
	});
	return fix.docChanged ? fix : null;
}
