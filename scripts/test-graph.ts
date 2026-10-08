/**
 * Checks the graph blocks ($lib/graph). Run with: npm run test:graph
 *
 * As with notes and blanks, the property that matters most: a handout must not
 * carry an answer — not drawn, and not anywhere in the page source.
 *
 * `npm run test:graph -- graphs.md > out.html` renders a file of ```graph
 * fences (or any curriculum Markdown) into a page to look at.
 */
import { readFileSync } from 'node:fs';
import { compile, parseGraph, renderGraph } from '../src/lib/graph.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';

if (process.argv[2]) {
	const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
	const katex = new URL('../node_modules/katex/dist/katex.min.css', import.meta.url).href;
	const src = readFileSync(process.argv[2], 'utf8');
	const html =
		`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${katex}"><style>${css}</style><body style="padding:2rem">` +
		`<h2>Teacher copy</h2><div class="md">${renderMarkdown(src)}</div>` +
		`<h2>Handout</h2><div class="md">${renderMarkdown(src, { notes: false })}</div>\n`;
	// Exit once it is written: a pipe takes it asynchronously, and exiting at once cuts it off.
	await new Promise((done) => process.stdout.write(html, done));
	process.exit(0);
}

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

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const at = (src: string, x: number) => compile(src)(x);

// Expressions, written the way they are said
check('polynomial', at('2x^2 - 3x + 1', 2) === 3);
check('implicit products', at('3(x - 1)^2', 3) === 12 && at('x(x+1)', 2) === 6 && at('(x+1)(x-1)', 3) === 8);
check('leading minus binds looser than ^', at('-x^2', 3) === -9);
check('negative exponent', at('2^-x', 1) === 0.5);
check('right-associative ^', at('2^3^2', 0) === 512);
check('functions without parentheses', close(at('sin x', Math.PI / 2), 1) && close(at('2sin(x)', Math.PI / 2), 2));
check('sin^2 x', close(at('sin^2 x + cos^2 x', 0.7), 1));
check('constants', close(at('pi', 0), Math.PI) && close(at('e^x', 1), Math.E));
check('ln and log', close(at('ln x', Math.E), 1) && close(at('log x', 100), 2));
check('sqrt and abs', at('sqrt(x + 4)', 5) === 3 && at('abs(x)', -2) === 2);
check('unicode', at('3x² − 2·x', 2) === 8 && close(at('2π', 0), 2 * Math.PI) && at('√x', 9) === 3);
check('odd roots of negatives are real', close(at('x^(1/3)', -8), -2));
check('even roots of negatives are not', Number.isNaN(at('x^(1/2)', -4)));
check('exp is not e·x·p', close(at('exp(1)', 0), Math.E));

let threw = '';
try {
	compile('2 + sinh(x)');
} catch (e) {
	threw = (e as Error).message;
}
check('unknown names rejected with a sentence', /"sinh"/.test(threw), threw);
check('names written together', close(at('2pix', 1), 2 * Math.PI));

// Settings and items
const g = parseGraph(`x: -6..6
y: -4 to 8 step 2
y = x^2 - 4 "f"
f(x) = 1/(x - 3)
y = sqrt(x) for 0..4
asymptote x = 3
asymptote y = 0
x = -2
point (2, 0) x-intercept
open point (sqrt(4), pi) "hole"
[[y = 2x + 1]]`);
check('ranges', g.x.min === -6 && g.x.max === 6 && g.y.min === -4 && g.y.max === 8 && g.y.step === 2);
check('no errors in a good graph', g.errors.length === 0, g.errors.join(' '));
const kinds = g.items.map((i) => i.kind).join(',');
check('item kinds', kinds === 'curve,curve,curve,vline,asymptote,vline,point,point,curve', kinds);
check('quoted label', g.items[0].label === 'f');
check('f(x) names its curve', g.items[1].label === 'f(x)');
check('domain', g.items[2].kind === 'curve' && g.items[2].from === 0 && g.items[2].to === 4);
check('asymptotes are dashed, plain lines are not', g.items[3].kind === 'vline' && g.items[3].dashed && g.items[5].kind === 'vline' && !g.items[5].dashed);
check('point with an unquoted label', g.items[6].kind === 'point' && g.items[6].label === 'x-intercept' && !g.items[6].open);
check('open point with expressions', g.items[7].kind === 'point' && g.items[7].open && g.items[7].x === 2 && close(g.items[7].y, Math.PI));
check('answer line', g.items[8].answer && !g.items[0].answer);
check('y range defaults to x range', parseGraph('x: -3..3').y.max === 3);
check('default is -10..10', parseGraph('').x.min === -10);
check('wide ranges get a coarser grid', parseGraph('x: -100..100').x.step === 10);
check('whole-unit grid when the range allows', parseGraph('x: -6..6').x.step === 1 && parseGraph('x: -3..3').x.step === 1);
check('fractional grid only for small ranges', parseGraph('x: 0..2').x.step === 0.1);
const tickNumbers = (src: string) => [...renderGraph(src).matchAll(/class="g-num"[^>]*>([^<]*)</g)].map((m) => m[1]);
check('tick numbers counted from zero', !tickNumbers('x: -9..9\ny: -1..1\nsize: small').includes('-9'), tickNumbers('x: -9..9\ny: -1..1\nsize: small').join(' '));

const bad = parseGraph('x: 5..1\ny = 2 +\nplot this\npoint (1, 2, 3)\ny = x');
check('every bad line reported', bad.errors.length === 4, bad.errors.join(' | '));
check('good lines survive bad ones', bad.items.length === 1);

// Number lines
const nl = parseGraph('number line: -5..5\npoint -2\nopen point 3 "a"');
check('number line', nl.numberLine && nl.x.min === -5 && nl.items.length === 2);
check('number line points', nl.items[0].kind === 'point' && nl.items[0].x === -2 && nl.items[1].label === 'a');
const nlSvg = renderGraph('number line: -5..5\npoint -2\nopen point 3 "a"');
check('number line drawn', nlSvg.includes('<svg') && (nlSvg.match(/<circle/g) ?? []).length === 2 && nlSvg.includes('g-open'));

// Drawing
const svg = renderGraph('x: -5..5\ny = x^2 "f"\npoint (1, 1) "P"');
check('svg with a curve, a point and labels', svg.includes('class="g-curve"') && svg.includes('<circle') && svg.includes('>P<') && svg.includes('>f<'));
check('labels escaped', renderGraph('point (1, 1) "<script>"').includes('&lt;script&gt;') && !renderGraph('point (1, 1) "<script>"').includes('<script>'));
check('numbers: off', !renderGraph('x: -5..5\nnumbers: off').includes('g-num') && renderGraph('x: -5..5').includes('g-num'));

/** The number of separate strokes in a curve's path. */
const strokes = (src: string) => (/class="g-curve"[^>]*d="([^"]*)"/.exec(renderGraph(src))?.[1].match(/M/g) ?? []).length;
// ±π/2 and ±3π/2 are all in view: four asymptotes, five pieces.
check('tan lifts the pen at each asymptote', strokes('x: -5..5\ny = tan x') === 5, String(strokes('x: -5..5\ny = tan x')));
check('1/x is two pieces, even on a wide range', strokes('x: -100..100\ny = 1/(x - 2)') === 2, String(strokes('x: -100..100\ny = 1/(x - 2)')));
check('a steep line stays one piece', strokes('x: -10..10\ny = 1000x') === 1, String(strokes('x: -10..10\ny = 1000x')));
check('sqrt starts where it is defined', strokes('x: -5..5\ny = sqrt(x)') === 1);

// Handouts
const answerGraph = 'x: -5..5\ny = 2x + 1 "line"\n[[y = x^2 "SECRET1"]]\n[[point (1, 1) SECRET2]]\nnonsense here';
const teacher = renderGraph(answerGraph);
const handout = renderGraph(answerGraph, { notes: false });
check('teacher copy draws answers in the answer style', teacher.includes('g-answer') && teacher.includes('SECRET1') && teacher.includes('SECRET2'));
check('handout has no answer at all', !/SECRET|g-answer/.test(handout), handout);
check('handout keeps the rest', handout.includes('>line<'));
check('errors only on the teacher copy', teacher.includes('graph-error') && !handout.includes('graph-error'));

// Through the Markdown renderer, inside an outline item
const doc = `::: outline
1. Quadratics
    - Sketch it:

        \`\`\`graph
        x: -4..4
        [[y = x^2 - 2 "SECRET3"]]
        \`\`\`

    - Next item
2. After
:::

\`\`\`js
const notAGraph = 1;
\`\`\`
`;
const full = renderMarkdown(doc);
const out = renderMarkdown(doc, { notes: false });
check('graph fence renders inside an outline item', full.includes('<svg') && /<li>[\s\S]*<svg[\s\S]*Next item/.test(full));
check('outline not cut short by the graph', full.includes('After') && (full.match(/class="outline"/g) ?? []).length === 1);
check('handout graph is blank', out.includes('<svg') && !out.includes('SECRET3'));
check('other fences are still code', full.includes('<code class="language-js">'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
