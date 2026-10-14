/**
 * Checks the live editor's parser ($lib/editor/syntax) finds the curriculum
 * constructs where markdown-it does. Run with: npm run test:editor
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type StateCommand } from '@codemirror/state';
import { GFM, parser as base } from '@lezer/markdown';
import { listMarker } from '../src/lib/editor/markers.ts';
import { addLine, removeLineAfter, removeLineBefore } from '../src/lib/editor/space.ts';
import { curriculumSyntax } from '../src/lib/editor/syntax.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';

const parser = base.configure([GFM, curriculumSyntax]);

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
	if (cond) {
		passed++;
	} else {
		failed++;
		console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
	}
}

/** Every node of a type, as the source text it covers. */
function nodes(src: string, type: string): string[] {
	const found: string[] = [];
	parser.parse(src).iterate({
		enter(n) {
			if (n.name === type) found.push(src.slice(n.from, n.to));
		}
	});
	return found;
}

function same(name: string, got: string[], want: string[]) {
	check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// Inline math and the dollar heuristics.
same('inline math', nodes('Area is $\\pi r^2$ here.', 'InlineMath'), ['$\\pi r^2$']);
same('prices are prose', nodes('Between $5 and $10 a day.', 'InlineMath'), []);
same('escaped dollar', nodes('Costs \\$5 and $x$.', 'InlineMath'), ['$x$']);
same('inline display', nodes('So $$x = 1$$ holds.', 'InlineMath'), ['$$x = 1$$']);

// Display math blocks.
same('math block', nodes('Before\n\n$$\nx = 1\n- y\n$$\n\nAfter', 'MathBlock'), ['$$\nx = 1\n- y\n$$']);
same('one-line math block', nodes('$$x^2$$\n', 'MathBlock'), ['$$x^2$$']);
same('math block ends a paragraph', nodes('Text\n$$\nx\n$$', 'MathBlock'), ['$$\nx\n$$']);
same('math block in a list', nodes('- Item\n\n    $$\n    x\n    $$\n- Next', 'MathBlock'), ['$$\n    x\n    $$']);

// Notes and blanks, stepping over math and code.
same('note', nodes('- Limits {{ask them first}}', 'TeacherNote'), ['{{ask them first}}']);
same('note with math braces', nodes('{{use $x^{2}}$ here}} done', 'TeacherNote'), ['{{use $x^{2}}$ here}}']);
same('note with code', nodes('{{type `}}` there}} done', 'TeacherNote'), ['{{type `}}` there}}']);
same('math inside note', nodes('{{say $x$}}', 'InlineMath'), ['$x$']);
same('blank', nodes('A [[system]] of equations', 'Blank'), ['[[system]]']);
same('blank lines prefix', nodes('[[3: every ordered pair]]', 'BlankLines'), ['3:']);
same('blank is not a link', nodes('[[answer]]', 'Link'), []);
same('empty note is text', nodes('{{}}', 'TeacherNote'), []);
same('emphasis in note', nodes('{{*careful*}}', 'Emphasis'), ['*careful*']);

// Outline fences end the list above them, as markdown-it-container does.
const outline = '::: outline\n- Limits\n    - Intuition\n:::\n\nAfter';
same('outline fences', nodes(outline, 'OutlineFence'), ['::: outline', ':::']);
same('closing fence is not list text', nodes(outline, 'Paragraph'), ['Limits', 'Intuition', 'After']);
same('other containers are text', nodes('::: warning\n', 'OutlineFence'), []);

// No raw HTML.
same('no html', nodes('<b>hi</b>', 'HTMLTag'), []);

// Graph fences are ordinary fenced code to the parser.
same('graph fence', nodes('```graph\nx: -5..5\n```', 'CodeInfo'), ['graph']);

// List markers: the reader's numbering, not the typed one.
function markers(src: string, outlined: boolean): string[] {
	const found: string[] = [];
	parser.parse(src).iterate({
		enter(n) {
			if (n.name === 'ListItem') found.push(listMarker(n.node, (a, b) => src.slice(a, b), outlined));
		}
	});
	return found;
}

same('outline counts from 1', markers('- A\n- B\n    - x\n    - y\n        - 1\n            - deep', true), ['I.', 'II.', 'a.', 'b.', '1.', '–']);
same('outline starts where the list does', markers('4. Four\n5. Five', true), ['IV.', 'V.']);
same('later numbers are ignored', markers('4. A\n4. B\n9. C', true), ['IV.', 'V.', 'VI.']);
// Only a list starting at 1 can interrupt a paragraph, so this one needs the blank line.
same('nested start', markers('- A\n\n    3. c\n    1. d', true), ['I.', 'c.', 'd.']);
check('reader agrees on nested start', /<ol start="3">/.test(renderMarkdown('::: outline\n- A\n\n    3. c\n    1. d\n:::')));
same('plain ordered list renumbers', markers('1. A\n1. B\n1. C', false), ['1.', '2.', '3.']);
same('plain ordered list start', markers('7. A\n8. B', false), ['7.', '8.']);
same('plain bullets', markers('- A\n- B', false), ['•', '•']);
same('roman out of range falls back', markers('0. Zero', true), ['0.']);
// …and markdown-it agrees on where the count starts.
check('reader starts at 4', /<ol start="4">/.test(renderMarkdown('::: outline\n4. Four\n5. Five\n:::')));

// Writing spaces: Enter and Backspace change the count behind the scenes.
// `|` marks the cursor, before and after.
function key(name: string, command: StateCommand, before: string, after: string) {
	const at = before.indexOf('|');
	let state = EditorState.create({
		doc: before.replace('|', ''),
		selection: { anchor: at },
		extensions: markdown({ base: markdownLanguage, extensions: [curriculumSyntax] })
	});
	ensureSyntaxTree(state, state.doc.length, 1000);
	const handled = command({ state, dispatch: (tr) => (state = tr.state) });
	const got = handled ? state.sliceDoc(0, state.selection.main.head) + '|' + state.sliceDoc(state.selection.main.head) : 'not handled';
	check(name, got === after, `got ${JSON.stringify(got)}, want ${JSON.stringify(after)}`);
}

key('enter adds a line', addLine, 'Q [[3: ans|]]', 'Q [[4: ans|]]');
key('enter in an empty space', addLine, 'Q [[3: |]]', 'Q [[4: |]]');
key('enter stops at 12', addLine, 'Q [[12: a|]]', 'Q [[12: a|]]');
key('enter makes a blank a space', addLine, 'A [[sys|tem]] b', 'A [[1: sys|tem]] b');
key('enter elsewhere is ordinary', addLine, 'Q| [[3: ans]]', 'not handled');
key('backspace at answer start', removeLineBefore, 'Q [[3: |ans]]', 'Q [[2: |ans]]');
key('backspace after the space', removeLineBefore, 'Q [[3: ans]]| x', 'Q [[2: ans]]| x');
key('backspace in the answer is ordinary', removeLineBefore, 'Q [[3: an|s]]', 'not handled');
key('last line of an empty space goes', removeLineBefore, 'Q [[1: ]]|', 'Q |');
key('last line with an answer stays', removeLineBefore, 'Q [[1: ans]]|', 'Q [[1: ans|]]');
key('delete at answer end', removeLineAfter, 'Q [[10: ans|]]', 'Q [[9: ans|]]');
key('delete before the space', removeLineAfter, 'Q |[[2: ans]]', 'Q |[[1: ans]]');
key('a count past 12 shrinks from 12', removeLineAfter, 'Q [[20: ans|]]', 'Q [[11: ans|]]');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
