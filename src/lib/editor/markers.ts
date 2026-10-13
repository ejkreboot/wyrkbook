/**
 * The marker the reader shows for a list item, worked out from the editor's
 * parse tree so the live editor can show the same one. markdown-it gives an
 * ordered list `start` = its first item's number and counts on from there,
 * whatever the later items say; the browser then draws that count in the
 * list's style. Outlines (see the outline CSS in app.css) style by depth —
 * I. → a. → 1. → – — and a bullet list in one counts from 1 like any `<ul>`.
 */
import type { SyntaxNode } from '@lezer/common';

const ROMAN: [number, string][] = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
	[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

// Out of a style's range the browser falls back to decimal, so these do too.
function roman(n: number): string {
	if (n < 1 || n > 3999) return String(n);
	let out = '';
	for (const [v, s] of ROMAN) for (; n >= v; n -= v) out += s;
	return out;
}

function alpha(n: number): string {
	if (n < 1) return String(n);
	let out = '';
	for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
	return out;
}

const isList = (n: SyntaxNode | null) => n?.name === 'BulletList' || n?.name === 'OrderedList';

/** How many lists the item sits in: 1 for a top-level item. */
export function listDepth(item: SyntaxNode): number {
	let depth = 0;
	for (let p = item.parent; p; p = p.parent) if (isList(p)) depth++;
	return depth;
}

/** The number the reader counts this item as: its list's start plus its place in the list. */
export function itemNumber(item: SyntaxNode, read: (from: number, to: number) => string): number {
	let n = 1;
	for (let s = item.prevSibling; s; s = s.prevSibling) if (s.name === 'ListItem') n++;
	const list = item.parent;
	if (list?.name !== 'OrderedList') return n;
	const first = list.getChild('ListItem')?.getChild('ListMark');
	const start = first ? Number(/\d+/.exec(read(first.from, first.to))?.[0] ?? 1) : 1;
	return start + n - 1;
}

/** What the reader draws in front of a list item, or null to keep the typed marker. */
export function listMarker(item: SyntaxNode, read: (from: number, to: number) => string, outlined: boolean): string {
	const n = itemNumber(item, read);
	if (outlined) {
		const depth = listDepth(item);
		if (depth === 1) return roman(n) + '.';
		if (depth === 2) return alpha(n) + '.';
		if (depth === 3) return n + '.';
		return '–';
	}
	return item.parent?.name === 'OrderedList' ? n + '.' : '•';
}
