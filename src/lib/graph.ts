/**
 * Graphs for curriculum documents: coordinate planes and number lines written
 * as a few lines of text in a ```graph fence, drawn as SVG by $lib/markdown.
 *
 *     ```graph
 *     x: -6..6
 *     y: -4..8
 *     y = x^2 - 4 "f"
 *     asymptote x = 3
 *     point (2, 0) x-intercept
 *     [[y = 2x + 1]]
 *     ```
 *
 *     ```graph
 *     number line: -5..5
 *     point -2
 *     open point 3 "a"
 *     ```
 *
 * Settings, one per line, all optional:
 *
 *     x: -6..6 step 2      the x range (also `-6 to 6`), and grid spacing
 *     y: -4..8             the y range; defaults to the x range
 *     number line: -5..5   a number line instead of a plane
 *     size: small | medium | large
 *     numbers: off         no numbers on the axes, for students to fill in
 *
 * Items, one per line:
 *
 *     y = <expression in x> [for a..b] ["label"]
 *     x = <number> ["label"]                          a vertical line
 *     asymptote x = <number> | asymptote y = <expression>   dashed
 *     point (a, b) [label] | open point (a, b) [label]
 *     point a [label]                                 on a number line
 *
 * Expressions are written the way they are said: 2x^2 - 3x + 1, 3(x - 1)^2,
 * sin x, sqrt(x + 4), 1/(x - 2), abs(x), ln x, e^x, pi. Unicode − × · π √ ² ³
 * work too.
 *
 * An item wrapped in [[double brackets]] is an answer: drawn in the teacher
 * copy's blue, and with `notes: false` not drawn at all — so a handout can be
 * an empty grid while the teacher's copy shows the graph students should draw.
 *
 * A line that can't be read is left out of the drawing; the teacher copy says
 * which and why under it. No DOM, so scripts/test-graph.ts runs it under tsx.
 */

/* ------------------------------------------------------------ expressions */

type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	sec: (v) => 1 / Math.cos(v),
	csc: (v) => 1 / Math.sin(v),
	cot: (v) => 1 / Math.tan(v),
	arcsin: Math.asin,
	arccos: Math.acos,
	arctan: Math.atan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sqrt: Math.sqrt,
	cbrt: Math.cbrt,
	abs: Math.abs,
	ln: Math.log,
	log: Math.log10,
	exp: Math.exp
};
// Longest first, so `arcsin` is not read as `a`…, and `sec` before `e`.
const NAMES = [...Object.keys(FUNCS), 'pi', 'e', 'x'].sort((a, b) => b.length - a.length);

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
	const s = src
		.replace(/[−–]/g, '-')
		.replace(/[×·⋅]/g, '*')
		.replace(/÷/g, '/')
		.replace(/π/g, 'pi')
		.replace(/√/g, 'sqrt')
		.replace(/²/g, '^2')
		.replace(/³/g, '^3')
		.toLowerCase();
	const out: Tok[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (/\s/.test(c)) {
			i++;
		} else if (/[\d.]/.test(c)) {
			const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i))!;
			out.push({ t: 'num', v: Number(m[0]) });
			i += m[0].length;
		} else if (/[a-z]/.test(c)) {
			// A run of letters is names written together — "pix" is pi·x — and
			// is rejected whole if any of it is not, so the message quotes the word.
			const word = /^[a-z]+/.exec(s.slice(i))![0];
			const names: Tok[] = [];
			for (let j = 0; j < word.length; ) {
				const name = NAMES.find((n) => word.startsWith(n, j));
				if (!name) throw new Error(`"${word}" isn't something a graph knows — use x, pi, e, or sin, sqrt, ln …`);
				names.push({ t: 'name', v: name });
				j += name.length;
			}
			out.push(...names);
			i += word.length;
		} else if ('+-*/^(),'.includes(c)) {
			out.push({ t: 'op', v: c });
			i++;
		} else {
			throw new Error(`"${c}" can't go in an expression`);
		}
	}
	return out;
}

/**
 * Recursive descent, in the usual precedence: + − below × ÷ (and a product
 * written without a sign, as in 2x or 3(x+1)), below a leading minus, below ^.
 * So -x^2 is −(x²) and 2^-x works. `sin x` takes the next factor: sin 2x is
 * sin(2)·x, as most calculators read it — write sin(2x).
 */
export function compile(src: string): Fn {
	const toks = tokenize(src);
	let i = 0;
	const peek = () => toks[i];
	const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
	const expectOp = (v: string) => {
		if (!isOp(v)) throw new Error(`expected "${v}"`);
		i++;
	};

	function expr(): Fn {
		let left = term();
		while (isOp('+') || isOp('-')) {
			const op = toks[i++].v;
			const a = left;
			const b = term();
			left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
		}
		return left;
	}

	/** Can the next token start a factor? Then two factors side by side multiply. */
	const startsFactor = () => {
		const t = peek();
		return !!t && (t.t === 'num' || t.t === 'name' || (t.t === 'op' && t.v === '('));
	};

	function term(): Fn {
		let left = unary();
		for (;;) {
			if (isOp('*') || isOp('/')) {
				const op = toks[i++].v;
				const a = left;
				const b = unary();
				left = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
			} else if (startsFactor()) {
				const a = left;
				const b = power();
				left = (x) => a(x) * b(x);
			} else {
				return left;
			}
		}
	}

	function unary(): Fn {
		if (isOp('-')) {
			i++;
			const a = unary();
			return (x) => -a(x);
		}
		if (isOp('+')) {
			i++;
			return unary();
		}
		return power();
	}

	function power(): Fn {
		const base = primary();
		if (!isOp('^')) return base;
		i++;
		const exp = unary(); // right-associative: 2^3^2 is 2^9
		return (x) => realPow(base(x), exp(x));
	}

	function primary(): Fn {
		const t = toks[i++];
		if (!t) throw new Error('the expression ends too soon');
		if (t.t === 'num') return () => t.v;
		if (t.t === 'op') {
			if (t.v !== '(') throw new Error(`"${t.v}" is out of place`);
			const inner = expr();
			expectOp(')');
			return inner;
		}
		if (t.v === 'x') return (x) => x;
		if (t.v === 'pi') return () => Math.PI;
		if (t.v === 'e') return () => Math.E;
		const f = FUNCS[t.v];
		// sin^2 x, the textbook way of writing (sin x)^2.
		if (isOp('^')) {
			i++;
			const exp = unary();
			const arg = power();
			return (x) => realPow(f(arg(x)), exp(x));
		}
		const arg = power();
		return (x) => f(arg(x));
	}

	const fn = expr();
	if (i < toks.length) throw new Error(`"${(toks[i] as { v: unknown }).v}" is out of place`);
	return fn;
}

/** x^(1/3) of a negative x is real; Math.pow says NaN. Odd roots are kept real. */
function realPow(b: number, e: number): number {
	if (b >= 0 || Number.isInteger(e)) return Math.pow(b, e);
	const inv = 1 / e;
	if (Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return -Math.pow(-b, e);
	return NaN;
}

/** A number written as an expression: -2pi, 3/4, sqrt(2). */
function constant(src: string): number {
	if (/x/i.test(src.replace(/exp/gi, ''))) throw new Error(`"${src.trim()}" should be a number, not depend on x`);
	const v = compile(src)(0);
	if (!Number.isFinite(v)) throw new Error(`"${src.trim()}" isn't a number`);
	return v;
}

/* ------------------------------------------------------------------- spec */

type Range = { min: number; max: number; step: number };
type Label = string;

type Item =
	| { kind: 'curve'; fn: Fn; from: number; to: number; label: Label; answer: boolean }
	| { kind: 'vline'; x: number; dashed: boolean; label: Label; answer: boolean }
	| { kind: 'asymptote'; fn: Fn; label: Label; answer: boolean } // y = …, dashed
	| { kind: 'point'; x: number; y: number; open: boolean; label: Label; answer: boolean };

type Spec = {
	numberLine: boolean;
	x: Range;
	y: Range;
	size: 'small' | 'medium' | 'large';
	numbers: boolean;
	items: Item[];
	errors: string[];
};

/**
 * A grid step that gives at most about 24 cells — whole units whenever the
 * range is wide enough for them, since that is the grid students know.
 */
function niceStep(span: number): number {
	for (const mag of [0.1, 1, 10, 100, 1000, 10000]) {
		for (const m of [1, 2, 2.5, 5]) {
			const step = m * mag;
			if (step < 1 && span >= 4) continue;
			if (span / step <= 24) return step;
		}
	}
	return span / 20;
}

function parseRange(src: string): Range {
	const m = /^(.*?)(?:\.\.|\s+to\s+)(.*?)(?:\s+step\s+(.+))?$/i.exec(src.trim());
	if (!m) throw new Error(`write a range as -5..5`);
	const min = constant(m[1]);
	const max = constant(m[2]);
	if (!(max > min)) throw new Error(`the range should go from smaller to larger`);
	const step = m[3] ? constant(m[3]) : niceStep(max - min);
	if (!(step > 0) || (max - min) / step > 200) throw new Error(`that step is too small for the range`);
	return { min, max, step };
}

/** A trailing "quoted label", taken off the line. */
function takeLabel(line: string): [string, Label] {
	const m = /\s*"([^"]*)"\s*$/.exec(line);
	return m ? [line.slice(0, m.index), m[1]] : [line, ''];
}

export function parseGraph(src: string): Spec {
	const spec: Spec = {
		numberLine: false,
		x: { min: -10, max: 10, step: 1 },
		y: { min: NaN, max: NaN, step: 1 },
		size: 'medium',
		numbers: true,
		items: [],
		errors: []
	};

	src.split('\n').forEach((raw, n) => {
		let line = raw.trim();
		if (!line) return;
		let answer = false;
		const wrapped = /^\[\[([\s\S]*)\]\]$/.exec(line);
		if (wrapped) {
			answer = true;
			line = wrapped[1].trim();
		}
		try {
			readLine(spec, line, answer);
		} catch (e) {
			spec.errors.push(`Line ${n + 1}, "${raw.trim()}": ${(e as Error).message}.`);
		}
	});

	if (Number.isNaN(spec.y.min)) spec.y = { ...spec.x };
	return spec;
}

function readLine(spec: Spec, line: string, answer: boolean) {
	let m: RegExpExecArray | null;

	// Settings
	if ((m = /^number\s*line\s*:?\s*(.*)$/i.exec(line))) {
		spec.numberLine = true;
		if (m[1].trim()) spec.x = parseRange(m[1]);
		return;
	}
	if ((m = /^([xy])\s*:\s*(.+)$/i.exec(line))) {
		spec[m[1].toLowerCase() as 'x' | 'y'] = parseRange(m[2]);
		return;
	}
	if ((m = /^size\s*:\s*(\w+)$/i.exec(line))) {
		const size = m[1].toLowerCase();
		if (size !== 'small' && size !== 'medium' && size !== 'large') throw new Error('size is small, medium or large');
		spec.size = size;
		return;
	}
	if ((m = /^numbers\s*:\s*(\w+)$/i.exec(line))) {
		spec.numbers = !/^(off|no|none|false|hide)$/i.test(m[1]);
		return;
	}

	const [body, label] = takeLabel(line);

	// Points: point (a, b) label · open point a label
	if ((m = /^(open\s+|closed\s+|filled\s+)?point\s+(.+)$/i.exec(body))) {
		const open = /^open/i.test(m[1] ?? '');
		const rest = m[2].trim();
		const pair = coordinates(rest);
		if (pair) {
			const [a, b, after] = pair;
			spec.items.push({ kind: 'point', x: constant(a), y: constant(b), open, label: label || after, answer });
			return;
		}
		// A bare number, for a number line: the number is the first word.
		const single = /^(\S+)\s*(.*)$/.exec(rest)!;
		spec.items.push({ kind: 'point', x: constant(single[1]), y: 0, open, label: label || single[2], answer });
		return;
	}

	// Asymptotes and vertical lines
	const dashed = /^asymptote\s*:?\s*/i.test(body);
	const eq = body.replace(/^asymptote\s*:?\s*/i, '');
	if ((m = /^x\s*=\s*(.+)$/i.exec(eq))) {
		spec.items.push({ kind: 'vline', x: constant(m[1]), dashed, label, answer });
		return;
	}

	// y = f(x), f(x) = …, optionally `for a..b`
	if ((m = /^(?:y|[a-z]\s*\(\s*x\s*\))\s*=\s*(.+?)(?:\s+for\s+(.+))?$/i.exec(eq))) {
		const fn = compile(m[1]);
		if (dashed) {
			spec.items.push({ kind: 'asymptote', fn, label, answer });
			return;
		}
		let from = -Infinity;
		let to = Infinity;
		if (m[2]) {
			const r = /^(.*?)(?:\.\.|\s+to\s+)(.*)$/i.exec(m[2].trim());
			if (!r) throw new Error('write the domain as for -2..3');
			from = constant(r[1]);
			to = constant(r[2]);
		}
		// Named f(x) = …: the name is the label unless one is given.
		const named = /^([a-z])\s*\(\s*x\s*\)/i.exec(eq);
		spec.items.push({ kind: 'curve', fn, from, to, label: label || (named ? `${named[1]}(x)` : ''), answer });
		return;
	}

	throw new Error(
		dashed
			? 'write an asymptote as "asymptote x = 3" or "asymptote y = 2x + 1"'
			: 'not something a graph knows — try "y = x^2", "point (1, 2)", "asymptote x = 3" or "x: -5..5"'
	);
}

/**
 * "(a, b) rest" → [a, b, rest], where a and b can hold parentheses of their
 * own, as in (sqrt(2), 1). Null when the text doesn't start with a pair.
 */
function coordinates(text: string): [string, string, string] | null {
	if (text[0] !== '(') return null;
	let depth = 0;
	let comma = -1;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '(') depth++;
		else if (c === ')' && --depth === 0) {
			if (comma === -1) throw new Error('a point needs two coordinates, as in (2, -1)');
			return [text.slice(1, comma), text.slice(comma + 1, i), text.slice(i + 1).trim()];
		} else if (c === ',' && depth === 1) {
			if (comma !== -1) throw new Error('a point has two coordinates, not three');
			comma = i;
		}
	}
	throw new Error('a ")" is missing');
}

/* ---------------------------------------------------------------- drawing */

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Short, and never "-0" or "0.30000000000000004". */
function num(v: number): string {
	const r = Math.round(v * 1000) / 1000;
	return String(Object.is(r, -0) ? 0 : r);
}
const px = (v: number) => String(Math.round(v * 10) / 10);

/** The values on a range's grid: every step from the first at or after min. */
function ticks(r: Range): number[] {
	const out: number[] = [];
	const first = Math.ceil(r.min / r.step - 1e-9) * r.step;
	for (let v = first; v <= r.max + r.step * 1e-9; v += r.step) out.push(Math.abs(v) < r.step * 1e-9 ? 0 : v);
	return out;
}

/** How often to number the ticks, so the numbers don't run into each other. */
function every(cellPx: number, widest: number): number {
	for (const n of [1, 2, 5, 10, 20, 50]) if (cellPx * n >= widest) return n;
	return 100;
}

/** Whether to number tick v, numbering every nth step counted from zero: 2, 4, 6, not 1, 3, 5. */
function numbered(v: number, r: Range, n: number): boolean {
	const k = v / (r.step * n);
	return Math.abs(k - Math.round(k)) < 1e-6;
}

const SIZE = { small: 180, medium: 300, large: 460 };
const LINE_SIZE = { small: 260, medium: 420, large: 600 };
const PAD = 24;
const CHAR = 6.2; // room for a tick number per character, at the 9px used, with some air

function arrow(x: number, y: number, dx: number, dy: number): string {
	// A small filled head pointing along (dx, dy).
	const s = 6;
	const w = 3.2;
	const bx = x - dx * s;
	const by = y - dy * s;
	return `<polygon class="g-head" points="${px(x)},${px(y)} ${px(bx - dy * w)},${px(by + dx * w)} ${px(bx + dy * w)},${px(by - dx * w)}"/>`;
}

export type GraphOptions = { notes?: boolean };

export function renderGraph(src: string, { notes = true }: GraphOptions = {}): string {
	const spec = parseGraph(src);
	const items = notes ? spec.items : spec.items.filter((it) => !it.answer);
	const svg = spec.numberLine ? numberLine(spec, items) : plane(spec, items);
	const errors =
		notes && spec.errors.length
			? `<div class="graph-error">${spec.errors.map(esc).join('<br>')}</div>`
			: '';
	return `<div class="graph-wrap">${svg}${errors}</div>\n`;
}

function plane(spec: Spec, items: Item[]): string {
	const { x: X, y: Y } = spec;
	const nx = (X.max - X.min) / X.step;
	const ny = (Y.max - Y.min) / Y.step;
	const cell = SIZE[spec.size] / Math.max(nx, ny);
	const sx = cell / X.step;
	const sy = cell / Y.step;
	const W = (X.max - X.min) * sx;
	const H = (Y.max - Y.min) * sy;
	const left = PAD + (spec.numbers ? 10 : 0);
	const top = PAD - 6;
	const toX = (v: number) => left + (v - X.min) * sx;
	const toY = (v: number) => top + (Y.max - v) * sy;
	const xTicks = ticks(X);
	const yTicks = ticks(Y);

	// The axes sit at zero, or along the edge nearest it when zero is out of view.
	const ax = toY(Math.min(Y.max, Math.max(Y.min, 0)));
	const ay = toX(Math.min(X.max, Math.max(X.min, 0)));

	const out: string[] = [];
	const clipId = `g${hash(JSON.stringify([X, Y, spec.size, spec.numbers]))}`;
	out.push(`<clipPath id="${clipId}"><rect x="${px(left)}" y="${px(top)}" width="${px(W)}" height="${px(H)}"/></clipPath>`);

	// Grid
	const grid = [
		...xTicks.map((v) => `M${px(toX(v))} ${px(top)}V${px(top + H)}`),
		...yTicks.map((v) => `M${px(left)} ${px(toY(v))}H${px(left + W)}`)
	].join('');
	out.push(`<path class="g-grid" d="${grid}"/>`);

	// Axes, with arrows past both ends
	const ext = 9;
	out.push(`<path class="g-axis" d="M${px(left - ext)} ${px(ax)}H${px(left + W + ext)}M${px(ay)} ${px(top - ext)}V${px(top + H + ext)}"/>`);
	out.push(arrow(left + W + ext + 2, ax, 1, 0), arrow(left - ext - 2, ax, -1, 0));
	out.push(arrow(ay, top - ext - 2, 0, -1), arrow(ay, top + H + ext + 2, 0, 1));
	out.push(`<text class="g-name" x="${px(left + W + ext + 6)}" y="${px(ax + 3)}">x</text>`);
	out.push(`<text class="g-name" x="${px(ay + 6)}" y="${px(top - ext)}">y</text>`);

	// Tick numbers, skipping zero, below the x axis and left of the y axis
	if (spec.numbers) {
		const xEvery = every(cell, Math.max(...xTicks.map((v) => num(v).length)) * CHAR + 3);
		const yEvery = every(cell, 11);
		for (const v of xTicks) {
			if (v === 0 || !numbered(v, X, xEvery)) continue;
			out.push(`<text class="g-num" x="${px(toX(v))}" y="${px(ax + 11)}" text-anchor="middle">${num(v)}</text>`);
		}
		for (const v of yTicks) {
			if (v === 0 || !numbered(v, Y, yEvery)) continue;
			out.push(`<text class="g-num" x="${px(ay - 3)}" y="${px(toY(v) + 3)}" text-anchor="end">${num(v)}</text>`);
		}
	}

	// Asymptotes and lines under curves, curves under points
	const order = { vline: 0, asymptote: 0, curve: 1, point: 2 };
	for (const it of [...items].sort((a, b) => order[a.kind] - order[b.kind])) {
		const cls = (base: string) => `${base}${it.answer ? ' g-answer' : ''}`;
		if (it.kind === 'vline') {
			if (it.x < X.min || it.x > X.max) continue;
			out.push(`<path class="${cls(it.dashed ? 'g-asym' : 'g-curve')}" d="M${px(toX(it.x))} ${px(top)}V${px(top + H)}"/>`);
			if (it.label) out.push(labelAt(toX(it.x) + 4, top + 9, it.label, it.answer));
		} else if (it.kind === 'asymptote' || it.kind === 'curve') {
			const from = it.kind === 'curve' ? Math.max(X.min, it.from) : X.min;
			const to = it.kind === 'curve' ? Math.min(X.max, it.to) : X.max;
			if (!(to > from)) continue;
			const { d, end } = trace(it.fn, from, to, toX, toY, top, H);
			if (!d) continue;
			out.push(`<path class="${cls(it.kind === 'asymptote' ? 'g-asym' : 'g-curve')}" clip-path="url(#${clipId})" d="${d}"/>`);
			if (it.label && end) out.push(labelAt(Math.min(end[0] + 4, left + W - 4), end[1] - 5, it.label, it.answer, end[0] + 4 > left + W - 40));
		} else {
			if (it.x < X.min || it.x > X.max || it.y < Y.min || it.y > Y.max) continue;
			out.push(dot(toX(it.x), toY(it.y), it.open, it.answer));
			if (it.label) out.push(labelAt(toX(it.x) + 5, toY(it.y) - 6, it.label, it.answer, toX(it.x) > left + W - 40));
		}
	}

	const width = left + W + PAD;
	const height = top + H + PAD;
	return svgOpen(width, height) + out.join('') + '</svg>';
}

function numberLine(spec: Spec, items: Item[]): string {
	const X = spec.x;
	const n = (X.max - X.min) / X.step;
	const cell = LINE_SIZE[spec.size] / n;
	const sx = cell / X.step;
	const left = PAD;
	const W = (X.max - X.min) * sx;
	const y = 30;
	const toX = (v: number) => left + (v - X.min) * sx;
	const xTicks = ticks(X);

	const out: string[] = [];
	const ext = 12;
	out.push(`<path class="g-axis" d="M${px(left - ext)} ${y}H${px(left + W + ext)}"/>`);
	out.push(arrow(left + W + ext + 2, y, 1, 0), arrow(left - ext - 2, y, -1, 0));
	out.push(`<path class="g-axis" d="${xTicks.map((v) => `M${px(toX(v))} ${y - 5}V${y + 5}`).join('')}"/>`);
	if (spec.numbers) {
		const xEvery = every(cell, Math.max(...xTicks.map((v) => num(v).length)) * CHAR + 3);
		xTicks.forEach((v) => {
			if (numbered(v, X, xEvery))
				out.push(`<text class="g-num" x="${px(toX(v))}" y="${y + 17}" text-anchor="middle">${num(v)}</text>`);
		});
	}
	for (const it of items) {
		if (it.kind !== 'point' || it.x < X.min || it.x > X.max) continue;
		out.push(dot(toX(it.x), y, it.open, it.answer, 4));
		if (it.label) out.push(`<text class="g-label${it.answer ? ' g-answer' : ''}" x="${px(toX(it.x))}" y="${y - 10}" text-anchor="middle">${esc(it.label)}</text>`);
	}
	return svgOpen(left + W + PAD, y + 26) + out.join('') + '</svg>';
}

function svgOpen(w: number, h: number): string {
	return `<svg class="graph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(w)} ${px(h)}" width="${px(w)}" height="${px(h)}" role="img">`;
}

function dot(x: number, y: number, open: boolean, answer: boolean, r = 3.2): string {
	return `<circle class="g-point${open ? ' g-open' : ''}${answer ? ' g-answer' : ''}" cx="${px(x)}" cy="${px(y)}" r="${r}"/>`;
}

function labelAt(x: number, y: number, text: string, answer: boolean, flip = false): string {
	return `<text class="g-label${answer ? ' g-answer' : ''}" x="${px(flip ? x - 10 : x)}" y="${px(y)}"${flip ? ' text-anchor="end"' : ''}>${esc(text)}</text>`;
}

/**
 * Samples a function across [from, to] into an SVG path. The pen lifts where it
 * is undefined, and across an asymptote: where two samples in a row are off
 * opposite edges of the view and the function halfway between them isn't
 * between them too, joining them would draw a vertical line that isn't there.
 * A steep but continuous curve passes that test and is drawn. `end` is the
 * last point drawn in view, for the label.
 */
function trace(
	fn: Fn,
	from: number,
	to: number,
	toX: (v: number) => number,
	toY: (v: number) => number,
	top: number,
	H: number
): { d: string; end: [number, number] | null } {
	const N = 800;
	const LIMIT = 1e5;
	const at = (x: number) => {
		try {
			return fn(x);
		} catch {
			return NaN;
		}
	};
	let d = '';
	let prev: { x: number; y: number; py: number } | null = null;
	let end: [number, number] | null = null;

	for (let k = 0; k <= N; k++) {
		const x = from + ((to - from) * k) / N;
		const y = at(x);
		if (!Number.isFinite(y)) {
			prev = null;
			continue;
		}
		const py = Math.max(-LIMIT, Math.min(LIMIT, toY(y)));
		let down = prev !== null;
		if (prev && ((prev.py < top && py > top + H) || (prev.py > top + H && py < top))) {
			const mid = at((prev.x + x) / 2);
			if (!(mid >= Math.min(prev.y, y) && mid <= Math.max(prev.y, y))) down = false;
		}
		d += `${down ? 'L' : 'M'}${px(toX(x))} ${px(py)}`;
		prev = { x, y, py };
		if (py >= top && py <= top + H) end = [toX(x), py];
	}
	return { d, end };
}

/** A short stable id, so a graph's clip path doesn't depend on render order. */
function hash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}
