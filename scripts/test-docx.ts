/**
 * Checks the Word reader behind the importer. Run with: npm run test:docx
 *
 * Builds a small .docx in memory with the things handouts are made of — Word's
 * own outline numbering, underlined blanks, answers in red or hidden text,
 * tables, text boxes and equations — and checks what comes out.
 *
 * `npm run test:docx -- notes.docx` prints what the importer would send for a
 * real document instead (no API call).
 *
 * `npm run test:docx -- convert handout.docx teacher.docx > lecture.md` runs a
 * lecture's documents through the importer's prompt and prints the Markdown —
 * the way to tune src/lib/server/importPrompt.ts. Pass `-` for a document you
 * don't have. CLASS and NOTES set the class name and the teacher's notes. It
 * costs an API call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { mergePictures, readDocx } from '../src/lib/docx.ts';
import { importParams } from '../src/lib/server/importPrompt.ts';

const args = process.argv.slice(2);
if (args[0] === 'convert') {
	await convert(args[1], args[2]);
	process.exit(0);
}
if (args[0]) {
	const r = readDocx(new Uint8Array(readFileSync(args[0])));
	const kinds = r.pictures.map((p) => `${p.n}: ${p.name}${p.type ? '' : ' (not drawable)'}`).join(', ');
	console.error(`${r.text.length} characters · ${r.equationObjects} equation objects · pictures ${kinds || 'none'}\n`);
	// Exit once it is written: a pipe takes it asynchronously, and exiting at once cuts it off.
	await new Promise((done) => process.stdout.write(r.text + '\n', done));
	process.exit(0);
}

async function convert(handoutPath = '-', teacherPath = '-') {
	const read = (path: string) => (path === '-' ? null : readDocx(new Uint8Array(readFileSync(path))));
	const docs = [read(handoutPath), read(teacherPath)];
	const { texts, pictures: all } = mergePictures(docs);
	const named = (path: string, text: string | null) => (text === null ? null : { name: path.split('/').pop()!, text });
	const handout = named(handoutPath, texts[0]);
	const teacher = named(teacherPath, texts[1]);
	// The browser shrinks every picture to JPEG; here PNG, JPEG and WebP go as they are and the rest are missing.
	const SENDABLE = ['image/png', 'image/jpeg', 'image/webp'] as const;
	const pictures = all
		.filter((p) => SENDABLE.includes(p.type as (typeof SENDABLE)[number]) && p.bytes.length < 5_000_000)
		.map((p) => ({ n: p.n, media_type: p.type as (typeof SENDABLE)[number], data: Buffer.from(p.bytes).toString('base64') }));
	const missing = all.filter((p) => !pictures.some((q) => q.n === p.n)).map((p) => p.n);
	console.error(`${pictures.length} pictures sent${missing.length ? `, missing ${missing.join(', ')}` : ''}`);
	if (!handout && !teacher) {
		console.error('Usage: npm run test:docx -- convert <handout.docx|-> <teacher.docx|->');
		process.exit(1);
	}

	const env = Object.fromEntries(
		readFileSync(new URL('../.env', import.meta.url), 'utf8')
			.split('\n')
			.filter((l) => l.trim() && !l.trim().startsWith('#'))
			.map((l) => {
				const i = l.indexOf('=');
				return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
			})
	);
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY });
	const example = readFileSync(new URL('../src/lib/server/outline-example.md', import.meta.url), 'utf8');

	const t0 = Date.now();
	const stream = client.messages.stream(
		importParams({
			model: process.env.MODEL ?? 'claude-opus-5-5',
			example,
			handout,
			teacher,
			pictures,
			missing,
			className: process.env.CLASS ?? '',
			instructions: process.env.NOTES ?? ''
		})
	);
	stream.on('text', (t) => process.stdout.write(t));
	const response = await stream.finalMessage();
	await new Promise((done) => process.stdout.write('\n', done));
	const u = response.usage;
	console.error(
		`\n${response.stop_reason} · ${u.input_tokens} in (${u.cache_read_input_tokens ?? 0} cached) / ` +
			`${u.output_tokens} out · ${((Date.now() - t0) / 1000).toFixed(0)}s`
	);
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

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

const r = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (runs: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
const li = (ilvl: number, runs: string) => p(runs, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>`);

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p(r('Systems of Equations'), '<w:pStyle w:val="Titel"/>')}
${p(r('Intro &amp; overview'), '<w:pStyle w:val="Heading2"/>')}
${li(0, r('Linear Systems'))}
${li(1, r('A solution makes every equation ') + r('true', '<w:color w:val="C00000"/>') + r('.'))}
${li(1, r('Blank: ') + `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/><w:tab/></w:r>`)}
${li(2, r('Hidden answer: ') + r('ae - bd', '<w:vanish/>'))}
${li(0, r('Determinants'))}
${li(1, r('Bold ', '<w:b/>') + r('and', '<w:b/>') + r(' highlight', '<w:highlight w:val="yellow"/>'))}
${p(r('Formula: ') + '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:den></m:f></m:oMath>')}
${p('<m:oMathPara><m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>b</m:t></m:r></m:e></m:rad></m:oMath></m:oMathPara>')}
${p(r('Indented by the ruler'), '<w:ind w:left="1440"/>')}
${p('<w:r><w:sym w:font="Symbol" w:char="F070"/></w:r>' + r(' is pi'))}
${p('<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>' + p(r('Inside a text box')) + '</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>' + p(r('Inside a text box')) + '</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>')}
${p('<w:r><w:drawing><pic/></w:drawing></w:r>')}
${p(r('Graph: ') + '<w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r>')}
${p(r('Same graph again: ') + '<w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r>')}
${p(r('Old clip art: ') + '<w:r><w:pict><v:shape><v:imagedata r:id="rId6"/></v:shape></w:pict></w:r>')}
${p('<w:r><w:object><o:OLEObject/></w:object></w:r>')}
<w:tbl><w:tr><w:tc>${p(r('Term'))}</w:tc><w:tc>${p(r('Meaning'))}</w:tc></w:tr><w:tr><w:tc>${p(r('D'))}</w:tc><w:tc>${p(r('denominator'))}</w:tc></w:tr></w:tbl>
${li(1, r('Room to write'))}
${p('')}${p('')}${p('')}
${p(r('One empty paragraph after this is spacing'))}
${p('')}
${p('<w:del><w:r><w:delText>deleted</w:delText></w:r></w:del>' + r('kept'))}
${li(1, r('Line breaks below') + '<w:r><w:br/><w:br/></w:r>')}
${p(r('Then a paragraph of breaks'))}
${p('<w:r><w:br/><w:br/></w:r>')}
${li(0, r('Third section'))}
<w:sectPr/></w:body></w:document>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="7">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%2."/></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3)"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num>
</w:numbering>`;

// A German Word names its title style "Titel" by id but "Title" by name.
const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="…/image" Target="media/image1.png"/>
<Relationship Id="rId6" Type="…/image" Target="media/image2.emf"/>
<Relationship Id="rId9" Type="…/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const EMF = new Uint8Array([1, 0, 0, 0, 9]);

const docx = zipSync({
	'[Content_Types].xml': strToU8('<Types/>'),
	'word/document.xml': strToU8(documentXml),
	'word/_rels/document.xml.rels': strToU8(relsXml),
	'word/media/image1.png': PNG,
	'word/media/image2.emf': EMF,
	'word/numbering.xml': strToU8(numberingXml),
	'word/styles.xml': strToU8(stylesXml)
});

const out = readDocx(docx);
const lines = out.text.split('\n');
const has = (s: string) => out.text.includes(s);

check('title style by name', lines[0] === '# Systems of Equations', lines[0]);
check('heading 2, entities decoded', has('## Intro & overview'));
check('top level numbered I.', has('I.\tLinear Systems'));
check('second level A.', has('\tA.\tA solution makes every equation <color C00000>true</color>.'));
check('second level continues to B.', has('\tB.\tBlank: <u>\t\t</u>'));
check('third level 1)', has('\t\t1)\tHidden answer: <hidden>ae - bd</hidden>'));
check('next top level II., sub-levels restart', has('II.\tDeterminants') && has('\tA.\t<b>Bold and</b><mark yellow> highlight</mark>'));
check('numbering continues past other paragraphs', has('III.\tThird section'));
check('inline equation as LaTeX', has('Formula: $\\frac{a}{{x}^{2}}$'), out.text);
check('display equation', has('$$\\sqrt{b}$$'));
check('ruler indent as tabs', has('\t\tIndented by the ruler'));
check('Symbol font Greek', has('π is pi'));
check('text box read once', out.text.split('Inside a text box').length === 2, out.text);
check('equation object counted, unreadable picture marked', out.equationObjects === 1 && has('[equation object]') && has('[picture]\n'));
check('pictures numbered in place', has('Graph: [picture 1]') && has('Old clip art: [picture 2]'));
check('a picture used twice keeps its number', has('Same graph again: [picture 1]') && out.pictures.length === 2);
check('picture bytes and types', out.pictures[0].type === 'image/png' && out.pictures[0].bytes.length === PNG.length && out.pictures[1].type === null);

// Across a handout and a teacher copy: shared pictures are sent once.
const doc = (text: string, pics: [number, Uint8Array][]) => ({
	text,
	equationObjects: 0,
	pictures: pics.map(([n, bytes]) => ({ n, name: `image${n}.png`, type: 'image/png', bytes }))
});
const A = new Uint8Array([1, 2, 3]);
const B = new Uint8Array([4, 5, 6]);
const C = new Uint8Array([7, 8, 9]);
const merged = mergePictures([
	doc('h [picture 1] [picture 2]', [[1, A], [2, B]]),
	null,
	doc('t [picture 1] [picture 2] [picture 3]', [[1, B], [2, C], [3, A]])
]);
check('merged pictures are distinct', merged.pictures.length === 3 && merged.pictures.map((p) => p.n).join() === '1,2,3');
check('texts renumbered to the shared set', merged.texts[0] === 'h [picture 1] [picture 2]' && merged.texts[2] === 't [picture 2] [picture 3] [picture 1]', String(merged.texts));
check('a missing document stays missing', merged.texts[1] === null);
check('table rows', has('| Term | Meaning |') && has('| D | denominator |'));
check('empty paragraphs counted as writing space', has('\tB.\tRoom to write\n[3 empty lines]\n'), out.text);
check('a single empty paragraph is only spacing', has('spacing\n\n') && !has('[1 empty'));
check('trailing line breaks counted as writing space', has('Line breaks below\n[2 empty lines]\n'), out.text);
check('a paragraph of line breaks counted as writing space', has('paragraph of breaks\n[3 empty lines]\n'), out.text);
check('no stray markers', !has('\u0000'));
check('tracked deletion left out', has('kept') && !has('deleted'));

let threw = '';
try {
	readDocx(strToU8('not a zip'));
} catch (e) {
	threw = (e as Error).message;
}
check('non-docx rejected with a sentence', /Word document/.test(threw), threw);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
	console.log('\n--- extracted ---\n' + out.text);
	process.exit(1);
}
