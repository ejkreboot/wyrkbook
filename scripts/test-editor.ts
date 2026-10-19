/**
 * Checks that a body read into the editor and written back out renders the same
 * as before — the Markdown half of the Milkdown editor ($lib/editor/remark),
 * without the browser. Run with: npm run test:editor
 *
 * The editor goes Markdown → mdast → ProseMirror → mdast → Markdown; this covers
 * the two ends, which is where our own syntax lives.
 */
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { prepareMarkdown, remarkCurriculum, stringifyOptions } from '../src/lib/editor/remark.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';
import { remapRegion } from '../src/lib/outlineRegion.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
	if (cond) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkMath)
	.use(remarkCurriculum)
	.use(remarkStringify, stringifyOptions as never);

function roundTrip(src: string): string {
	const prepared = prepareMarkdown(src);
	return processor.stringify(processor.runSync(processor.parse(prepared)) as never);
}

function tree(src: string) {
	return processor.runSync(processor.parse(prepareMarkdown(src))) as unknown as { children: Node[] };
}
type Node = { type: string; value?: string; lines?: number; children?: Node[] };
const find = (n: Node, type: string): Node[] =>
	[...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap((c) => find(c, type))];

const CASES: Record<string, string> = {
	'notes and math': `# Derivatives

The slope of $x^2$ is $2x$. {{ask with $y^{2}}$ in it}}

{{Pause here and draw the graph}}

- Limits {{ask them to guess the **sign** first}}
- {{only a note}}
- After`,
	'blanks': `- Two equations in the same variables form a [[system]].
- Solution set: [[2: every ordered pair that satisfies both]]
- Show work: [[4: ]]
- A note with a blank {{say [[this]] aloud}}`,
	'outline, closed tight': `Intro paragraph.
::: outline
- Limits
    - Intuition {{draw it}}
        - Detail
    - Formal
- Continuity
:::
After.`,
	'outline, ordered': `::: outline
1. First
    1. Sub
2. Second
:::`,
	'unclosed outline': `::: outline
- Runs to the end
    - of the document`,
	'display math variants': `Before
$$ x = 1 $$
Middle

$$\\frac{a}{b}
= c$$

$$
\\int_0^1 x\\,dx
$$`,
	'graph fence': '```graph\nx: -5..5\ny: -5..5\ny = x^2 - 3\n[[point (0, -3) "vertex"]]\n```',
	'code fence with fence-like lines': '```\n::: outline\n$$ x $$\n```',
	'literal brackets and dollars': `Interval [0, 1] and {{unclosed and [[ alone. Costs \\$5 and \\$10.

Empty {{}} and [[]] stay as typed.`,
	'table': `| a | b |
| - | - |
| $x$ | [[y]] |`
};

// KaTeX copies the TeX into an annotation, spaces and all; the math drawn is what matters.
const rendered = (src: string, notes: boolean) =>
	renderMarkdown(src, { notes }).replace(/(<annotation[^>]*>)([^<]*)/g, (_, tag, tex) => tag + tex.trim());

console.log('Round trip renders the same (teacher copy and handout)');
for (const [name, src] of Object.entries(CASES)) {
	const out = roundTrip(src);
	for (const notes of [true, false]) {
		const want = rendered(src, notes);
		const got = rendered(out, notes);
		check(`${name} (${notes ? 'teacher' : 'handout'})`, want === got, `\n--- source\n${src}\n--- written\n${out}\n--- want\n${want}\n--- got\n${got}`);
	}
	check(`${name}: writing is stable`, roundTrip(out) === out, `\n${out}\n---\n${roundTrip(out)}`);
}

console.log('Parsed shape');
{
	const t = tree(CASES['blanks']);
	const blanks = find(t as unknown as Node, 'blank');
	check('four blanks', blanks.length === 4, String(blanks.length));
	check('fill-in blank has no lines', blanks[0]?.lines === 0);
	check('writing space keeps its count', blanks[1]?.lines === 2);
	check('empty writing space', blanks[2]?.lines === 4 && !blanks[2]?.children?.length);
	check('blank nests in a note', find(find(t as unknown as Node, 'teacherNote')[0], 'blank').length === 1);
}
{
	const t = tree(CASES['outline, closed tight']) as unknown as Node;
	const outlines = find(t, 'outline');
	check('one outline', outlines.length === 1);
	check('outline holds the list', outlines[0]?.children?.[0]?.type === 'list');
	check('paragraph after the outline stays outside', t.children?.at(-1)?.type === 'paragraph');
}
{
	const t = tree('Note $}}$ inside {{a $x^{2}}$ b}}') as unknown as Node;
	const notes = find(t, 'teacherNote');
	check('}} in math neither closes nor opens a note', notes.length === 1 && find(notes[0], 'inlineMath').length === 1);
}
{
	const t = tree(CASES['literal brackets and dollars']) as unknown as Node;
	check('no notes or blanks from unclosed or empty markers', !find(t, 'teacherNote').length && !find(t, 'blank').length);
}

{
	// Milkdown's remarkMarker runs first and tags strong/emphasis with `marker`.
	function visit(n: Node) {
		if (n.type === 'strong' || n.type === 'emphasis') (n as Node & { marker: string }).marker = '*';
		n.children?.forEach(visit);
	}
	const tagged = processor.parse('{{a **b** c}}') as unknown as Node;
	visit(tagged);
	processor.runSync(tagged as never);
	check('bold inside a note survives nodes carrying a `marker`', find(tagged, 'strong').length === 1 && find(tagged, 'teacherNote').length === 1);
}

console.log('Empty lines');
{
	// What Milkdown hands the printer for a line left empty under an outline item.
	const emptyLine = { type: 'paragraph', children: [{ type: 'html', value: '<br />' }] };
	const item = (text: string, more: object[] = []) => ({
		type: 'listItem',
		spread: false,
		children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }, ...more]
	});
	const written = processor.stringify({
		type: 'root',
		children: [{ type: 'list', ordered: false, spread: false, children: [item('Solution:', [emptyLine, emptyLine]), item('Next')] }]
	} as never);
	check('an empty line is written apart from the text above it', written.includes('Solution:\n\n  <br />\n\n  <br />'), JSON.stringify(written));
	const html = renderMarkdown(written, { notes: true });
	check('the reader draws it as space, not as "<br />"', !html.includes('&lt;br') && (html.match(/class="empty-line"/g) ?? []).length === 2, html);
	check('…in the same item, so numbering carries on', (html.match(/<li/g) ?? []).length === 2, html);
	const handout = renderMarkdown('Before\n\n<br />\n\n<br />\n\nAfter', { notes: false });
	check('the handout keeps empty lines', (handout.match(/class="empty-line"/g) ?? []).length === 2, handout);
	const cell = renderMarkdown('| a | b |\n| - | - |\n| <br /> | x |', { notes: true });
	check('an empty table cell shows empty', !cell.includes('&lt;br'), cell);
	check('empty lines are stable', roundTrip(written) === written, roundTrip(written));
}

console.log('The generated outline is followed through a rewrite');
{
	const intro = '# Limits\n\nSome *intro* text.\n';
	const outline = '::: outline\n* Limits\n    * Intuition {{draw it}}\n* Continuity\n:::\n';
	const after = '\nAfter the outline, [[a blank]].\n';
	const body = intro + '\n' + outline + after;
	const start = intro.length + 1;
	const region = { start, end: start + outline.length };
	const written = roundTrip(body);
	const moved = remapRegion(region, body, written);
	check('region found', moved !== null);
	const got = moved ? written.slice(moved.start, moved.end) : '';
	check('region is the outline, rewritten', got === roundTrip(outline).trim(), JSON.stringify(got));
	const empty = remapRegion({ start: body.length, end: body.length }, body, written);
	check('an empty region at the end stays at the end', empty?.start === written.length);
	check('blocks that do not line up give null', remapRegion(region, body, written + '\n\nMore.') === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
