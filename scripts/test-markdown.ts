/**
 * Checks the curriculum Markdown renderer. Run with: npm run test:markdown
 *
 * The property that matters most: a handout rendered with `notes: false` must
 * not contain a single character of a teacher note.
 */
import { readFileSync } from 'node:fs';
import { renderMarkdown, countNotes } from '../src/lib/markdown.ts';

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

const DOC = `# Derivatives

The slope of $x^2$ is $2x$. {{INLINE-SECRET with $y^{2}}$ in it}}

{{SECRET: ask them to guess first.}}

$$
\\frac{d}{dx} x^n = n x^{n-1}
$$

Tickets cost between $5 and $10.
`;

const full = renderMarkdown(DOC);
const handout = renderMarkdown(DOC, { notes: false });

check('note rendered for the teacher', full.includes('class="teacher-note"') && full.includes('SECRET'));
check('note absent from handout', !/SECRET|\{\{|\}\}/.test(handout) && !handout.includes('teacher-note'), handout);
check('rest of document survives stripping', handout.includes('Derivatives') && handout.includes('Tickets'));
check('countNotes', countNotes(DOC) === 2, String(countNotes(DOC)));

check('inline math', full.includes('class="katex"'));
check('display block', full.includes('class="math-block"') && full.includes('katex-display'));
check('prices left as prose', /between \$5 and \$10/.test(full), full);
check('escaped dollar is literal', renderMarkdown('costs \\$3').includes('costs $3'));
check('single-line $$ block', renderMarkdown('$$ a+b $$').includes('math-block'));
check('bad TeX does not throw', typeof renderMarkdown('$\\frac{$') === 'string');

check('raw html is escaped', !renderMarkdown('<script>alert(1)</script>').includes('<script>'));
check('javascript: links refused', !renderMarkdown('[x](javascript:alert(1))').includes('href="javascript'));
check('tables', renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |').includes('<table>'));

check('math inside a note renders', /teacher-note">INLINE-SECRET with <span class="katex/.test(full), full);
check('note-only paragraph gone, not left empty', !handout.includes('<p></p>'), handout);
check('unclosed braces stay literal', renderMarkdown('a {{b').includes('a {{b'));
check('escaped braces stay literal', renderMarkdown('\\{{b}}').includes('{{b}}'));
check('code span keeps braces', renderMarkdown('`{{x}}`').includes('<code>{{x}}</code>'));

const OUTLINE = `::: outline
- Limits {{LIMITS-SECRET}}
    - Intuition
    - {{ITEM-SECRET}}
    - Formal
        - sketch it {{with $x^{2}$}}
            - fourth level
- Continuity
:::

- plain step
`;
const outlined = renderMarkdown(OUTLINE);
const outlineHandout = renderMarkdown(OUTLINE, { notes: false });
check('outline wrapper', outlined.includes('<div class="outline">'), outlined);
check('dash outline nests four levels', /<ul>[\s\S]*<ul>[\s\S]*<ul>[\s\S]*<ul>/.test(outlined), outlined);
const resumed = renderMarkdown('::: outline\n3. Picks up at III\n:::');
check('outline keeps typed start number', resumed.includes('<ol start="3">'), resumed);
check(
	'list after the block is outside it',
	/<\/div>\s*<ul>\s*<li>plain step/.test(outlined),
	outlined
);
check('inline note in outline item for teacher', outlined.includes('Limits <span class="teacher-note">LIMITS-SECRET</span>'), outlined);
check('note-only item marked for teacher', outlined.includes('<li class="note-item"><span class="teacher-note">ITEM-SECRET'), outlined);
check('notes stripped from outline handout', !/SECRET|teacher-note|note-item/.test(outlineHandout), outlineHandout);
check('note-only item dropped, no empty <li>', !/<li>\s*<\/li>/.test(outlineHandout), outlineHandout);
check(
	'handout outline keeps its siblings in order',
	/Intuition<\/li>\s*<li>Formal/.test(outlineHandout) && outlineHandout.includes('Continuity'),
	outlineHandout
);

const allNotes = renderMarkdown('::: outline\n- {{a}}\n- {{b}}\n:::\n\nafter', { notes: false });
check('outline of only notes vanishes', !/<div class="outline">|<ul>/.test(allNotes) && allNotes.includes('after'), allNotes);

// Blanks: [[answer]] and [[n: answer]]. The answer is teacher-only.
const BLANKS = 'A set of equations is a [[BLANK-ANSWER]].\n\nSolution set: [[3: LINES-ANSWER with $x^{2}$]]\n\nEmpty: [[2:]] and [[ ]]';
const blanksTeacher = renderMarkdown(BLANKS);
const blanksHandout = renderMarkdown(BLANKS, { notes: false });
check('blank shows answer to teacher', blanksTeacher.includes('<span class="blank">BLANK-ANSWER</span>'), blanksTeacher);
check('writing space sized by n', blanksTeacher.includes('<span class="write" style="--lines:3">'), blanksTeacher);
check('math inside writing space', /LINES-ANSWER with <span class="katex/.test(blanksTeacher), blanksTeacher);
check('handout blanks are empty', blanksHandout.includes('<span class="blank"></span>') && blanksHandout.includes('<span class="write" style="--lines:3"></span>'), blanksHandout);
check('no answer reaches the handout', !/ANSWER|katex/.test(blanksHandout), blanksHandout);
check('answerless space and blank', blanksTeacher.includes('style="--lines:2"></span>') && blanksTeacher.includes('<span class="blank"> </span>'), blanksTeacher);
check('lines clamped', renderMarkdown('[[99: x]]').includes('--lines:12'));
check('links still work', renderMarkdown('[a](https://example.com)').includes('<a href="https://example.com">a</a>'));
check('unclosed brackets stay literal', renderMarkdown('a [[b').includes('a [[b'));

// The generator's reference outline must render cleanly, and leak nothing.
const EXAMPLE = readFileSync(new URL('../src/lib/server/outline-example.md', import.meta.url), 'utf8');
const exTeacher = renderMarkdown(EXAMPLE);
const exHandout = renderMarkdown(EXAMPLE, { notes: false });
check('example: no raw syntax left', !/\[\[|\]\]|\{\{|\$|math-error/.test(exTeacher), exTeacher);
check('example: every answer stripped from handout', !/Cramer|denominator<|opposites|vmatrix|katex-display/.test(exHandout) && !exHandout.includes('ae - bd'), exHandout);
check('example: outline starts at I', exTeacher.includes('<div class="outline">\n<ol>'), exTeacher.slice(0, 300));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
