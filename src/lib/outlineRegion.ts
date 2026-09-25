/**
 * Keeps track of where a generated outline sits in the editor's body while the
 * teacher types around and inside it, so a later relevel replaces just that
 * stretch. Each input event is one contiguous change — a keystroke, a paste, a
 * toolbar insert — which the common prefix and suffix of the text before and
 * after pin down.
 *
 * A change exactly at the outline's start is taken as before it, and one exactly
 * at its end as after it: typing on from the closing `:::` is new material, not
 * part of the outline.
 */
export type Region = { start: number; end: number };

export function followEdit(r: Region, before: string, after: string): Region & { touched: boolean } {
	const shorter = Math.min(before.length, after.length);
	let p = 0;
	while (p < shorter && before.charCodeAt(p) === after.charCodeAt(p)) p++;
	let s = 0;
	while (s < shorter - p && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s++;

	// before[p, oldEnd) became after[p, newEnd).
	const oldEnd = before.length - s;
	const newEnd = after.length - s;
	const delta = after.length - before.length;

	const start = r.start < p ? r.start : r.start >= oldEnd ? r.start + delta : p;
	const end = r.end <= p ? r.end : r.end >= oldEnd ? r.end + delta : newEnd;

	const touched =
		oldEnd > p
			? p < r.end && oldEnd > r.start // replaced or deleted text overlapping it
			: r.start < p && p < r.end; // a pure insertion strictly inside it

	return { start, end: Math.max(start, end), touched };
}

/** Where lines continuing an outline go: the start of its closing `:::` line, or -1 if it has none. */
export function closingFence(outline: string): number {
	const last = [...outline.matchAll(/^:::[ \t]*$/gm)].pop();
	return last?.index ?? -1;
}

/**
 * Tidies a continuation into whole lines: no blank lines around it, one newline
 * after, and no `:::` fence lines in case the model wrote the block's anyway.
 */
export function asLines(text: string): string {
	return (
		text
			.replace(/^:::.*(\n|$)/gm, '')
			.replace(/^\s*\n/, '')
			.replace(/\s+$/, '') + '\n'
	);
}

/** `outline` with `lines` added at the end of its `::: outline` block. */
export function continueOutline(outline: string, lines: string): string {
	const at = closingFence(outline);
	return at === -1
		? outline.replace(/\s*$/, '\n') + asLines(lines)
		: outline.slice(0, at) + asLines(lines) + outline.slice(at);
}
