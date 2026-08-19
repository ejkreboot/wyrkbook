/**
 * Weeks are the atomic unit in wyrkbook, so every date the app stores or compares
 * is normalized to the Monday of its ISO week and formatted as a plain YYYY-MM-DD
 * string. Working in local-noon Dates avoids the UTC-midnight rollback that shifts
 * a Monday to the previous Sunday in western timezones.
 */

export function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
	const [y, m, d] = s.split('-').map(Number);
	return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Monday of the week containing `d`. */
export function weekStart(d: Date = new Date()): string {
	const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
	const dow = x.getDay(); // 0 = Sunday
	const delta = dow === 0 ? -6 : 1 - dow;
	x.setDate(x.getDate() + delta);
	return toISODate(x);
}

export function addWeeks(isoMonday: string, n: number): string {
	const d = parseISODate(isoMonday);
	d.setDate(d.getDate() + n * 7);
	return toISODate(d);
}

/** The Mondays of every week that overlaps the given month. */
export function weeksInMonth(year: number, month0: number): string[] {
	const first = weekStart(new Date(year, month0, 1, 12));
	const lastDay = new Date(year, month0 + 1, 0, 12);
	const last = weekStart(lastDay);
	const out: string[] = [];
	let cur = first;
	while (cur <= last) {
		out.push(cur);
		cur = addWeeks(cur, 1);
	}
	return out;
}

const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

/** "Mar 3 – 9" style label for the week beginning `isoMonday`. */
export function weekLabel(isoMonday: string): string {
	const start = parseISODate(isoMonday);
	const end = parseISODate(isoMonday);
	end.setDate(end.getDate() + 6);
	const sm = MONTHS[start.getMonth()].slice(0, 3);
	const em = MONTHS[end.getMonth()].slice(0, 3);
	return start.getMonth() === end.getMonth()
		? `${sm} ${start.getDate()}–${end.getDate()}`
		: `${sm} ${start.getDate()} – ${em} ${end.getDate()}`;
}

export function monthLabel(year: number, month0: number): string {
	return `${MONTHS[month0]} ${year}`;
}

/** Whole weeks from one Monday to another; negative if `b` precedes `a`. */
export function weeksBetween(a: string, b: string): number {
	const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
	return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

export function isCurrentWeek(isoMonday: string): boolean {
	return isoMonday === weekStart();
}
