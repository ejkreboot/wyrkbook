/**
 * What the gradebook's boxes say, and what that means as a mark.
 *
 * A cell is a string in the browser and a number-or-null in the database, so the
 * two have to agree about what a string means: " 7.0 " and "7" are the same mark,
 * an empty box is a cleared cell, and "eight" is neither — it has to stop the
 * save rather than quietly become null and wipe a grade.
 *
 * Lives outside `$lib/server` because the grid runs it on every keystroke, the
 * same reason planFingerprint.ts does. Unlike that one, the save action imports
 * it too: what the button believes it is sending and what the server writes are
 * then the same computation rather than two that have to be kept in step.
 */

/** A mark, or null for a cell with nothing in it. */
export type Cell = number | null;

/** `${itemId}:${studentId}` -> whatever that box currently says. */
export type CellMap = Record<string, string>;

export const cellKey = (itemId: string, studentId: string) => `${itemId}:${studentId}`;

export function splitCellKey(key: string): { itemId: string; studentId: string } {
	const [itemId, studentId] = key.split(':');
	return { itemId, studentId };
}

/**
 * Read one box. `'invalid'` rather than a throw, because every caller wants to
 * carry on and mark the cell rather than abandon the grid.
 */
export function readCell(raw: string): Cell | 'invalid' {
	const t = (raw ?? '').trim();
	if (!t) return null;
	const n = Number(t);
	if (!Number.isFinite(n) || n < 0) return 'invalid';
	return Math.round(n * 100) / 100;
}

/** How a stored mark shows up in a box. Null is an empty box, not "null". */
export function writeCell(value: number | null): string {
	return value === null || value === undefined ? '' : String(value);
}

export function gradeFingerprint(cells: CellMap): string {
	return JSON.stringify(
		Object.keys(cells)
			.sort()
			.map((k) => [k, readCell(cells[k])])
	);
}

/**
 * The course grade: what was earned over what was possible, counting only items
 * that actually carry a mark.
 *
 * An unmarked item is not a zero — it is work nobody has looked at, and scoring
 * it zero would make every gradebook read as failing until the last column was
 * filled. A teacher who means a zero types a zero.
 *
 * Null when nothing is marked at all, so callers can show a dash rather than 0%.
 */
export function courseTotal(
	items: { id: string; points_possible: number }[],
	markFor: (itemId: string) => Cell
): { earned: number; possible: number; percent: number } | null {
	let earned = 0;
	let possible = 0;

	for (const item of items) {
		const mark = markFor(item.id);
		if (mark === null) continue;
		earned += mark;
		possible += Number(item.points_possible);
	}

	if (possible <= 0) return null;

	return {
		earned: Math.round(earned * 100) / 100,
		possible: Math.round(possible * 100) / 100,
		percent: Math.round((earned / possible) * 1000) / 10
	};
}
