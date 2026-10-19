/**
 * Room to work each problem, printed below it on the assignment sheet, in lines
 * of WORK_LINE_MM (migration 014). Sized by the AI ($lib/server/workSpacePrompt)
 * and changeable by the teacher.
 */

/** About college-ruled paper, the same pitch as the extra ruled pages. */
export const WORK_LINE_MM = 8.4;

export const MAX_WORK_LINES = 30;

/** What a problem never sized prints with: room for a short multi-step solution. */
export const DEFAULT_WORK_LINES = 6;

/** A count from a form or the AI, clamped to what the column takes; null if it isn't one. */
export function workLines(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Math.round(Number(value));
	return Number.isFinite(n) ? Math.min(MAX_WORK_LINES, Math.max(0, n)) : null;
}
