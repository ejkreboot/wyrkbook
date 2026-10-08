/**
 * Reads a Word document (.docx) into plain text and its pictures, for the
 * importer to convert. It runs in the browser, so what crosses the network is
 * the text and the pictures (shrunk there first), never the file — no 4.5 MB
 * request cap to trip over. Isomorphic (no DOM), so scripts/test-docx.ts runs
 * it under plain tsx.
 *
 * The text is not Markdown. It keeps what a teacher uses to tell a blank from
 * its answer — formatting, list numbering, indents — as light inline tags the
 * model reads and the importer's prompt explains:
 *
 *     # Heading text                     heading styles (and Title as #)
 *     II.	a.	Systems                     list labels as Word numbers them, a tab after
 *     	text                              a leading tab per indent level otherwise
 *     <b> <i> <u> <s>                    bold, italic, underline, strikethrough
 *     <color C00000> <mark yellow>       font color, highlight
 *     <hidden>                           hidden text, often where answers are kept
 *     $x^2$  $$…$$                       Word equations, written as LaTeX
 *     | a | b |                          table rows, one per line
 *     [3 empty lines]                    empty paragraphs in a row: writing space
 *     [picture 2]                        a picture, numbered in `pictures`
 *     [picture] [equation object]        a picture with nothing to send (a chart,
 *                                        a linked file); an equation stored as one
 *
 * Text boxes are read where they sit. Tracked deletions, comments, footnotes,
 * headers and footers are left out.
 */
import { unzipSync, strFromU8 } from 'fflate';

export type DocxText = {
	text: string;
	/** Equations stored as pictures (MathType, Equation Editor 3.0), whose content is lost. */
	equationObjects: number;
	/** The pictures the text numbers, in order. */
	pictures: Picture[];
};

export type Picture = {
	/** The N of `[picture N]` in the text. */
	n: number;
	name: string;
	/** A type a browser can draw, or null for one it can't (EMF, WMF, TIFF). */
	type: string | null;
	bytes: Uint8Array;
};

const DRAWABLE: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	svg: 'image/svg+xml'
};

export function readDocx(bytes: Uint8Array): DocxText {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (f) =>
				f.name.startsWith('word/media/') ||
				['word/document.xml', 'word/numbering.xml', 'word/styles.xml', 'word/_rels/document.xml.rels'].includes(f.name)
		});
	} catch {
		throw new Error('That is not a Word document (.docx) that can be opened.');
	}
	const doc = files['word/document.xml'];
	if (!doc) throw new Error('That is not a Word document (.docx) — it has no document inside.');

	// Pictures are referred to by relationship id; the rels file says which file in the zip each one is.
	const targets = new Map<string, string>();
	const rels = files['word/_rels/document.xml.rels'];
	if (rels) {
		for (const r of kids(find(parseXml(strFromU8(rels)), 'Relationships') ?? parseXml(''))) {
			if (r.attrs.TargetMode === 'External') continue;
			const target = r.attrs.Target ?? '';
			targets.set(r.attrs.Id, target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`);
		}
	}
	const media = (id: string) => {
		const path = targets.get(id);
		const data = path && files[path];
		return data ? { name: path.split('/').pop()!, bytes: data } : null;
	};

	const reader = new Reader(
		files['word/numbering.xml'] ? parseXml(strFromU8(files['word/numbering.xml'])) : null,
		files['word/styles.xml'] ? parseXml(strFromU8(files['word/styles.xml'])) : null,
		media
	);
	const body = find(parseXml(strFromU8(doc)), 'w:body');
	const lines = body ? reader.blocks(body) : [];

	return {
		text: emptyRuns(lines)
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim(),
		equationObjects: reader.equationObjects,
		pictures: reader.pictures
	};
}

/** What an empty paragraph reads as until emptyRuns counts it. */
const EMPTY = '\u0000';

/**
 * Empty paragraphs are how a handout leaves room to write, and how many there
 * are says how much room, so two or more in a row are counted out loud. One on
 * its own is only spacing.
 */
function emptyRuns(lines: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; ) {
		if (lines[i] !== EMPTY) {
			out.push(lines[i++]);
			continue;
		}
		let n = 0;
		while (lines[i] === EMPTY) n++, i++;
		out.push(n > 1 ? `[${n} empty lines]` : '');
	}
	return out;
}

/* ------------------------------------------------------------------ XML */

export type El = { name: string; attrs: Record<string, string>; children: (El | string)[] };

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});
}

/** Enough XML for Office's own output: elements, attributes, text. */
export function parseXml(xml: string): El {
	const root: El = { name: '#root', attrs: {}, children: [] };
	const stack = [root];
	const token = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
	const attr = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let m: RegExpExecArray | null;
	while ((m = token.exec(xml))) {
		const top = stack[stack.length - 1];
		if (m[1] !== undefined) top.children.push(m[1]);
		else if (m[6] !== undefined) top.children.push(decode(m[6]));
		else if (m[3] !== undefined) {
			if (m[2]) {
				if (stack.length > 1) stack.pop();
				continue;
			}
			const el: El = { name: m[3], attrs: {}, children: [] };
			let a: RegExpExecArray | null;
			attr.lastIndex = 0;
			while ((a = attr.exec(m[4]))) el.attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
			top.children.push(el);
			if (!m[5]) stack.push(el);
		}
	}
	return root;
}

const kids = (el: El) => el.children.filter((c): c is El => typeof c !== 'string');
const find = (el: El, name: string): El | undefined => {
	for (const c of kids(el)) {
		if (c.name === name) return c;
		const deeper = find(c, name);
		if (deeper) return deeper;
	}
};
const child = (el: El | undefined, name: string) => el && kids(el).find((c) => c.name === name);
const val = (el: El | undefined) => el?.attrs['w:val'] ?? el?.attrs['m:val'];
/** A w:b / w:i style toggle: present and not switched off. */
const on = (el: El | undefined) => !!el && !['0', 'false', 'none'].includes(val(el) ?? 'true');
const textOf = (el: El): string =>
	el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

/* ------------------------------------------------------------- numbering */

type Level = { fmt: string; text: string; start: number };

function toRoman(n: number): string {
	const table: [number, string][] = [
		[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
		[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
	];
	let out = '';
	for (const [v, s] of table) while (n >= v) (out += s), (n -= v);
	return out;
}

function toLetters(n: number): string {
	// a … z, then aa, bb, … as Word does it.
	return String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

function formatNumber(n: number, fmt: string): string {
	switch (fmt) {
		case 'upperRoman': return toRoman(n).toUpperCase();
		case 'lowerRoman': return toRoman(n);
		case 'upperLetter': return toLetters(n).toUpperCase();
		case 'lowerLetter': return toLetters(n);
		case 'decimalZero': return String(n).padStart(2, '0');
		default: return String(n);
	}
}

/* ------------------------------------------------------------------ math */

const NARY: Record<string, string> = {
	'∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
	'⋃': '\\bigcup', '⋂': '\\bigcap'
};
const ACCENT: Record<string, string> = {
	'̂': '\\hat', '̃': '\\tilde', '̄': '\\bar', '⃗': '\\vec', '̇': '\\dot', '̈': '\\ddot', '́': '\\acute', '̀': '\\grave'
};

/** OMML to LaTeX. Close is enough: the model tidies it into KaTeX. */
function math(el: El): string {
	const sub = (name: string) => {
		const c = child(el, name);
		return c ? math(c) : '';
	};
	const prop = (pr: string, name: string) => val(child(child(el, pr), name));

	switch (el.name) {
		case 'm:r':
			return kids(el)
				.filter((c) => c.name === 'm:t')
				.map(textOf)
				.join('');
		case 'm:f': {
			const type = prop('m:fPr', 'm:type');
			return type === 'lin' || type === 'skw'
				? `${sub('m:num')}/${sub('m:den')}`
				: `\\frac{${sub('m:num')}}{${sub('m:den')}}`;
		}
		case 'm:sSup':
			return `{${sub('m:e')}}^{${sub('m:sup')}}`;
		case 'm:sSub':
			return `{${sub('m:e')}}_{${sub('m:sub')}}`;
		case 'm:sSubSup':
			return `{${sub('m:e')}}_{${sub('m:sub')}}^{${sub('m:sup')}}`;
		case 'm:sPre':
			return `{}_{${sub('m:sub')}}^{${sub('m:sup')}}{${sub('m:e')}}`;
		case 'm:rad': {
			const deg = sub('m:deg');
			const hide = on(child(child(el, 'm:radPr'), 'm:degHide'));
			return !hide && deg ? `\\sqrt[${deg}]{${sub('m:e')}}` : `\\sqrt{${sub('m:e')}}`;
		}
		case 'm:d': {
			const pr = child(el, 'm:dPr');
			const open = val(child(pr, 'm:begChr')) ?? '(';
			const close = val(child(pr, 'm:endChr')) ?? ')';
			const sep = val(child(pr, 'm:sepChr')) ?? ',';
			const items = kids(el).filter((c) => c.name === 'm:e').map(math);
			const fence = (c: string) => (c === '' ? '.' : c === '{' ? '\\{' : c === '}' ? '\\}' : c === '|' ? '|' : c);
			return `\\left${fence(open)}${items.join(sep)}\\right${fence(close)}`;
		}
		case 'm:nary': {
			const chr = prop('m:naryPr', 'm:chr') ?? '∫';
			const op = NARY[chr] ?? chr;
			const lo = sub('m:sub');
			const hi = sub('m:sup');
			return `${op}${lo ? `_{${lo}}` : ''}${hi ? `^{${hi}}` : ''} ${sub('m:e')}`;
		}
		case 'm:func':
			return `${sub('m:fName')}\\,${sub('m:e')}`;
		case 'm:limLow':
			return `${sub('m:e')}_{${sub('m:lim')}}`;
		case 'm:limUpp':
			return `${sub('m:e')}^{${sub('m:lim')}}`;
		case 'm:acc': {
			const chr = prop('m:accPr', 'm:chr') ?? '̂';
			return `${ACCENT[chr] ?? '\\hat'}{${sub('m:e')}}`;
		}
		case 'm:bar':
			return prop('m:barPr', 'm:pos') === 'bot' ? `\\underline{${sub('m:e')}}` : `\\overline{${sub('m:e')}}`;
		case 'm:groupChr':
			return `\\underbrace{${sub('m:e')}}`;
		case 'm:m': {
			const rows = kids(el)
				.filter((c) => c.name === 'm:mr')
				.map((r) => kids(r).filter((c) => c.name === 'm:e').map(math).join(' & '));
			return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
		}
		case 'm:eqArr':
			return `\\begin{aligned} ${kids(el).filter((c) => c.name === 'm:e').map(math).join(' \\\\ ')} \\end{aligned}`;
		default:
			// m:e, m:num, m:box, m:borderBox, m:phant, m:oMath …: their parts in order.
			return kids(el)
				.filter((c) => !c.name.endsWith('Pr'))
				.map(math)
				.join('');
	}
}

/*
 * A w:sym is a character in a symbol font, its code in the font's private range
 * (F0xx). The Symbol font puts Greek on the Latin keys; anything else is
 * passed on as the plain character, which is right for most.
 */
const SYMBOL_UPPER = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
const SYMBOL_OTHER: Record<number, string> = {
	0xb1: '±', 0xb4: '×', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xa3: '≤', 0xb3: '≥',
	0xa5: '∞', 0xb6: '∂', 0xd6: '√', 0xe5: '∑', 0xf2: '∫', 0xae: '→', 0xde: '⇒', 0xb0: '°', 0xd7: '·'
};

function symbol(font: string, hex: string): string {
	let code = parseInt(hex, 16);
	if (!Number.isFinite(code)) return '';
	if (code >= 0xf000) code -= 0xf000;
	if (/^symbol$/i.test(font)) {
		if (code >= 0x41 && code <= 0x5a) return SYMBOL_UPPER[code - 0x41];
		if (code >= 0x61 && code <= 0x7a) return SYMBOL_LOWER[code - 0x61];
		if (SYMBOL_OTHER[code]) return SYMBOL_OTHER[code];
	}
	return code >= 0x20 ? String.fromCharCode(code) : '';
}

/* ------------------------------------------------------------- the body */

type Format = { b: boolean; i: boolean; u: boolean; s: boolean; color: string; mark: string; hidden: boolean };
const PLAIN: Format = { b: false, i: false, u: false, s: false, color: '', mark: '', hidden: false };

/** Wraps a run's text in the tags for its formatting, outermost first. */
function tag(text: string, f: Format): string {
	let out = text;
	if (f.u) out = `<u>${out}</u>`;
	if (f.s) out = `<s>${out}</s>`;
	if (f.i) out = `<i>${out}</i>`;
	if (f.b) out = `<b>${out}</b>`;
	if (f.color) out = `<color ${f.color}>${out}</color>`;
	if (f.mark) out = `<mark ${f.mark}>${out}</mark>`;
	if (f.hidden) out = `<hidden>${out}</hidden>`;
	return out;
}

const sameFormat = (a: Format, b: Format) =>
	a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.color === b.color && a.mark === b.mark && a.hidden === b.hidden;

class Reader {
	equationObjects = 0;
	pictures: Picture[] = [];
	private pictureOf = new Map<string, number>(); // relationship id → its N, so a reused picture keeps one

	private levels = new Map<string, Level[]>(); // numId → its levels
	private abstractOf = new Map<string, string>(); // numId → abstractNumId
	private counters = new Map<string, number[]>(); // abstractNumId → counts by level
	private headingLevel = new Map<string, number>(); // styleId → 1–6
	private styleNum = new Map<string, { numId: string; ilvl: number }>(); // list styles

	constructor(
		numbering: El | null,
		styles: El | null,
		private media: (id: string) => { name: string; bytes: Uint8Array } | null
	) {
		if (styles) {
			for (const s of kids(find(styles, 'w:styles') ?? styles)) {
				if (s.name !== 'w:style') continue;
				const id = s.attrs['w:styleId'];
				const name = (val(child(s, 'w:name')) ?? '').toLowerCase();
				const h = /^heading (\d)$/.exec(name);
				if (name === 'title') this.headingLevel.set(id, 1);
				else if (h) this.headingLevel.set(id, Math.min(6, Number(h[1])));
				const numPr = child(child(s, 'w:pPr'), 'w:numPr');
				const numId = val(child(numPr, 'w:numId'));
				if (numId) this.styleNum.set(id, { numId, ilvl: Number(val(child(numPr, 'w:ilvl')) ?? 0) });
			}
		}
		if (!numbering) return;
		const root = find(numbering, 'w:numbering') ?? numbering;
		const abstract = new Map<string, Level[]>();
		for (const a of kids(root).filter((c) => c.name === 'w:abstractNum')) {
			const lvls: Level[] = [];
			for (const l of kids(a).filter((c) => c.name === 'w:lvl')) {
				lvls[Number(l.attrs['w:ilvl'] ?? 0)] = {
					fmt: val(child(l, 'w:numFmt')) ?? 'decimal',
					text: val(child(l, 'w:lvlText')) ?? '',
					start: Number(val(child(l, 'w:start')) ?? 1)
				};
			}
			abstract.set(a.attrs['w:abstractNumId'], lvls);
		}
		for (const n of kids(root).filter((c) => c.name === 'w:num')) {
			const id = n.attrs['w:numId'];
			const abs = val(child(n, 'w:abstractNumId')) ?? '';
			this.abstractOf.set(id, abs);
			this.levels.set(id, abstract.get(abs) ?? []);
		}
	}

	/** Block-level content — the body, a table cell, a text box — as lines. */
	blocks(el: El): string[] {
		const out: string[] = [];
		for (const c of kids(el)) {
			if (c.name === 'w:p') out.push(this.paragraph(c));
			else if (c.name === 'w:tbl') out.push('', ...this.table(c), '');
			else if (c.name === 'w:sdt') out.push(...this.blocks(child(c, 'w:sdtContent') ?? c));
			else if (['w:customXml', 'w:ins', 'w:smartTag'].includes(c.name)) out.push(...this.blocks(c));
		}
		return out;
	}

	private table(tbl: El): string[] {
		return kids(tbl)
			.filter((r) => r.name === 'w:tr')
			.map((r) => {
				const cells = kids(r)
					.filter((c) => c.name === 'w:tc' || c.name === 'w:sdt')
					.map((c) =>
						this.blocks(c.name === 'w:sdt' ? (child(c, 'w:sdtContent') ?? c) : c)
							.map((l) => l.replace(EMPTY, '').trim())
							.filter(Boolean)
							.join(' / ')
					);
				return `| ${cells.join(' | ')} |`;
			});
	}

	private paragraph(p: El): string {
		const pPr = child(p, 'w:pPr');
		const style = val(child(pPr, 'w:pStyle')) ?? '';
		let prefix = '';

		const heading = this.headingLevel.get(style);
		const numPr = child(pPr, 'w:numPr');
		const fromStyle = this.styleNum.get(style);
		const numId = val(child(numPr, 'w:numId')) ?? fromStyle?.numId;
		const ilvl = Number(val(child(numPr, 'w:ilvl')) ?? fromStyle?.ilvl ?? 0);

		if (heading) {
			const label = numId && numId !== '0' ? this.label(numId, ilvl) : '';
			prefix = '#'.repeat(heading) + ' ' + (label ? label + ' ' : '');
		} else if (numId && numId !== '0') {
			const label = this.label(numId, ilvl);
			prefix = '\t'.repeat(ilvl) + (label ? label + '\t' : '');
		} else {
			// Indented with the ruler rather than tabs: a tab per half inch (720 twips).
			const left = Number(child(pPr, 'w:ind')?.attrs['w:left'] ?? child(pPr, 'w:ind')?.attrs['w:start'] ?? 0);
			if (left >= 360) prefix = '\t'.repeat(Math.max(1, Math.round(left / 720)));
		}

		const text = this.inline(p);
		return text.trim() || prefix.trim() ? prefix + text.replace(/\s+$/, '') : EMPTY;
	}

	/** The list label Word would show, e.g. "II." or "b)"; "•" for bullets. */
	private label(numId: string, ilvl: number): string {
		const levels = this.levels.get(numId);
		const lvl = levels?.[ilvl];
		if (!levels || !lvl) return '•';
		if (lvl.fmt === 'bullet') return '•';
		if (lvl.fmt === 'none') return '';

		const key = this.abstractOf.get(numId) ?? numId;
		const counts = this.counters.get(key) ?? [];
		counts[ilvl] = (counts[ilvl] ?? (lvl.start - 1)) + 1;
		counts.length = ilvl + 1; // deeper levels start over
		this.counters.set(key, counts);

		return lvl.text.replace(/%(\d)/g, (_, k: string) => {
			const i = Number(k) - 1;
			return formatNumber(counts[i] ?? levels[i]?.start ?? 1, levels[i]?.fmt ?? 'decimal');
		});
	}

	/** A paragraph's runs, equations and text boxes, with runs of one format merged. */
	private inline(p: El): string {
		const pieces: { text: string; f: Format }[] = [];
		const boxes: string[] = [];
		const push = (text: string, f: Format) => {
			const last = pieces[pieces.length - 1];
			if (last && sameFormat(last.f, f)) last.text += text;
			else pieces.push({ text, f });
		};

		const walk = (el: El) => {
			for (const c of kids(el)) {
				switch (c.name) {
					case 'w:r':
						this.run(c, push, boxes);
						break;
					case 'm:oMathPara':
						push(`\n$$${kids(c).filter((m) => m.name === 'm:oMath').map(math).join(' \\\\ ')}$$\n`, PLAIN);
						break;
					case 'm:oMath':
						push(`$${math(c)}$`, PLAIN);
						break;
					case 'mc:AlternateContent':
						walk(child(c, 'mc:Choice') ?? c);
						break;
					case 'w:del':
					case 'w:moveFrom':
					case 'w:pPr':
						break;
					default:
						// w:hyperlink, w:ins, w:smartTag, w:fldSimple, w:sdt/w:sdtContent …
						walk(c);
				}
			}
		};
		walk(p);

		const text = pieces
			.map(({ text, f }) => {
				// Tags around nothing but spaces are noise, except underlining: a blank.
				if (!text.trim() && !f.u) return text;
				return tag(text, f);
			})
			.join('');
		return boxes.length ? [text, ...boxes].filter((t) => t.trim()).join('\n') : text;
	}

	private run(r: El, push: (text: string, f: Format) => void, boxes: string[]) {
		const rPr = child(r, 'w:rPr');
		const u = val(child(rPr, 'w:u'));
		const color = val(child(rPr, 'w:color')) ?? '';
		const mark = val(child(rPr, 'w:highlight')) ?? child(rPr, 'w:shd')?.attrs['w:fill'] ?? '';
		const f: Format = {
			b: on(child(rPr, 'w:b')),
			i: on(child(rPr, 'w:i')),
			u: !!u && u !== 'none',
			s: on(child(rPr, 'w:strike')) || on(child(rPr, 'w:dstrike')),
			color: /^(auto|000000)$/i.test(color) ? '' : color,
			mark: /^(none|auto|FFFFFF)$/i.test(mark) ? '' : mark,
			hidden: on(child(rPr, 'w:vanish'))
		};

		for (const c of kids(r)) {
			switch (c.name) {
				case 'w:t':
					push(textOf(c), f);
					break;
				case 'w:tab':
				case 'w:ptab':
					push('\t', f);
					break;
				case 'w:br':
				case 'w:cr':
					push('\n', PLAIN);
					break;
				case 'w:noBreakHyphen':
					push('-', f);
					break;
				case 'w:sym':
					push(symbol(c.attrs['w:font'] ?? '', c.attrs['w:char'] ?? ''), f);
					break;
				case 'w:object':
					// An embedded OLE object: in a handout, nearly always an old-style equation.
					this.equationObjects++;
					push('[equation object]', PLAIN);
					break;
				case 'mc:AlternateContent':
				case 'w:drawing':
				case 'w:pict':
					this.drawing(c.name === 'mc:AlternateContent' ? (child(c, 'mc:Choice') ?? c) : c, push, boxes);
					break;
			}
		}
	}

	/** A picture, or a text box whose paragraphs are read in place. */
	private drawing(el: El, push: (text: string, f: Format) => void, boxes: string[]) {
		const box = find(el, 'w:txbxContent');
		if (box) {
			boxes.push(...this.blocks(box).filter((l) => l !== EMPTY && l.trim()));
			return;
		}
		if (find(el, 'w:object') || find(el, 'o:OLEObject')) {
			this.equationObjects++;
			push('[equation object]', PLAIN);
			return;
		}
		// DrawingML pictures name theirs on a:blip, old VML ones on v:imagedata.
		const id = find(el, 'a:blip')?.attrs['r:embed'] ?? find(el, 'v:imagedata')?.attrs['r:id'];
		const file = id ? this.media(id) : null;
		if (!id || !file) {
			push('[picture]', PLAIN);
			return;
		}
		let n = this.pictureOf.get(id);
		if (n === undefined) {
			n = this.pictures.length + 1;
			this.pictureOf.set(id, n);
			const ext = (file.name.split('.').pop() ?? '').toLowerCase();
			this.pictures.push({ n, name: file.name, type: DRAWABLE[ext] ?? null, bytes: file.bytes });
		}
		push(`[picture ${n}]`, PLAIN);
	}
}

/**
 * Numbers the pictures of a lecture's documents as one set, for one request.
 * The handout and the teacher's copy usually share their pictures, so a
 * picture that is byte-for-byte the same in both is sent once and keeps one
 * number; the texts' `[picture N]` are renumbered to match.
 */
export function mergePictures(docs: (DocxText | null)[]): { texts: (string | null)[]; pictures: Picture[] } {
	const pictures: Picture[] = [];
	const seen = new Map<string, Picture[]>(); // a cheap hash → the pictures with it

	const texts = docs.map((doc) => {
		if (!doc) return null;
		const renumber = new Map<number, number>();
		for (const p of doc.pictures) {
			const key = `${p.bytes.length}:${fnv(p.bytes)}`;
			const same = seen.get(key)?.find((q) => equal(q.bytes, p.bytes));
			if (same) {
				renumber.set(p.n, same.n);
				continue;
			}
			const merged = { ...p, n: pictures.length + 1 };
			pictures.push(merged);
			seen.set(key, [...(seen.get(key) ?? []), merged]);
			renumber.set(p.n, merged.n);
		}
		return doc.text.replace(/\[picture (\d+)\]/g, (m, n: string) =>
			renumber.has(Number(n)) ? `[picture ${renumber.get(Number(n))}]` : m
		);
	});
	return { texts, pictures };
}

function fnv(bytes: Uint8Array): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
	return h >>> 0;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
