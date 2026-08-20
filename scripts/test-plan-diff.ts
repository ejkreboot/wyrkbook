/**
 * Checks the planner's reconciliation logic. Run with: npm run test:plan
 *
 * The property that matters: editing one line in a week must not disturb the
 * other goals in it, because a disturbed goal loses its `done` tick.
 */
import { planDiff, type PlanWeek } from '../src/lib/server/planDiff.ts';
import { planFingerprint } from '../src/lib/planFingerprint.ts';
import type { WeeklyGoal } from '../src/lib/types.ts';

const CTX = { orgId: 'org-1', classId: 'class-1' };
const W1 = '2026-09-07';
const W2 = '2026-09-14';

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

function goal(id: string, week: string, title: string, sort: number, done = false): WeeklyGoal {
	return {
		id,
		org_id: CTX.orgId,
		class_id: CTX.classId,
		week_start: week,
		title,
		detail: null,
		assignment_id: null,
		done,
		sort_order: sort,
		created_at: ''
	};
}

function weeks(...w: PlanWeek[]) {
	return w;
}

// ---------------------------------------------------------------- 1. first save
{
	const d = planDiff(weeks({ week_start: W1, lines: ['Ch. 1', 'Practice 1A', 'Quiz 1'] }), [], CTX);
	console.log('\nEmpty week, three goals typed:');
	check('inserts all three', d.toInsert.length === 3);
	check('deletes nothing', d.toDelete.length === 0);
	check('numbers them in order', d.toInsert.every((r, i) => r.sort_order === i));
}

// ---------------------------------------------------------------- 2. the load-bearing case
{
	const existing = [
		goal('g1', W1, 'Ch. 1', 0, true), // already ticked off
		goal('g2', W1, 'Practice 1A', 1, false),
		goal('g3', W1, 'Quiz 1', 2, false)
	];
	// The teacher edits only the last line.
	const d = planDiff(
		weeks({ week_start: W1, lines: ['Ch. 1', 'Practice 1A', 'Quiz 1 (moved to Friday)'] }),
		existing,
		CTX
	);
	console.log('\nEditing one line in a week where a goal is already done:');
	check('leaves the completed goal alone', !d.toDelete.includes('g1'), `deleted ${d.toDelete}`);
	check('leaves the untouched goal alone', !d.toDelete.includes('g2'));
	check('removes only the edited line', d.toDelete.length === 1 && d.toDelete[0] === 'g3');
	check('inserts only the new text', d.toInsert.length === 1);
	check('does not rewrite the survivors', d.toUpsert.length === 0);
}

// ---------------------------------------------------------------- 3. reordering
{
	const existing = [goal('g1', W1, 'A', 0, true), goal('g2', W1, 'B', 1)];
	const d = planDiff(weeks({ week_start: W1, lines: ['B', 'A'] }), existing, CTX);
	console.log('\nSwapping two lines:');
	check('nothing deleted', d.toDelete.length === 0);
	check('nothing inserted', d.toInsert.length === 0);
	check('both rows repositioned', d.toUpsert.length === 2);
	check(
		'the done flag survives the move',
		d.toUpsert.find((r) => (r as WeeklyGoal).id === 'g1')?.done === true
	);
}

// ---------------------------------------------------------------- 4. clearing a week
{
	const existing = [goal('g1', W1, 'A', 0), goal('g2', W1, 'B', 1)];
	const d = planDiff(weeks({ week_start: W1, lines: [''] }), existing, CTX);
	console.log('\nEmptying a week:');
	check('removes both', d.toDelete.length === 2);
	check('inserts nothing', d.toInsert.length === 0);
}

// ---------------------------------------------------------------- 5. whitespace and blanks
{
	const d = planDiff(
		weeks({ week_start: W1, lines: ['  Ch. 1  ', '', '   ', 'Quiz 1'] }),
		[],
		CTX
	);
	console.log('\nBlank and padded lines:');
	check('drops empty lines', d.toInsert.length === 2);
	check('trims titles', d.toInsert[0].title === 'Ch. 1');
	check('renumbers after the blanks', d.toInsert[1].sort_order === 1);
}

// ---------------------------------------------------------------- 6. duplicates in one week
{
	const existing = [goal('g1', W1, 'Review', 0, true), goal('g2', W1, 'Review', 1, false)];
	const d = planDiff(weeks({ week_start: W1, lines: ['Review', 'Review'] }), existing, CTX);
	console.log('\nTwo identical titles in one week:');
	check('keeps both', d.toDelete.length === 0 && d.toInsert.length === 0);
}

// ---------------------------------------------------------------- 7. week isolation
{
	const existing = [goal('g1', W1, 'A', 0, true), goal('g2', W2, 'B', 0, true)];
	// Only week 1 is submitted; week 2 must be untouched.
	const d = planDiff(weeks({ week_start: W1, lines: ['A'] }), existing, CTX);
	console.log('\nA week outside the submitted range:');
	check('does not touch the other week', !d.toDelete.includes('g2'), `deleted ${d.toDelete}`);
	check('nothing deleted at all', d.toDelete.length === 0);
}

// ---------------------------------------------------------------- 8. moving between weeks
{
	const existing = [goal('g1', W1, 'Ch. 1', 0, true)];
	const d = planDiff(
		weeks({ week_start: W1, lines: [] }, { week_start: W2, lines: ['Ch. 1'] }),
		existing,
		CTX
	);
	console.log('\nDragging a goal to the following week:');
	check('removes it from the old week', d.toDelete.length === 1);
	check('adds it to the new week', d.toInsert.length === 1);
	check('lands in the right week', d.toInsert[0].week_start === W2);
	console.log('        (note: a goal moved between weeks is re-created, so its');
	console.log('         done tick does not follow it — see README)');
}

// -------------------------------------------- 9. the Save button agrees with the diff
/*
 * The planner greys out Save until `planFingerprint` says the boxes differ from
 * what the server sent. That judgement has to match what planDiff would actually
 * do, in both directions: a false "unchanged" loses an edit behind a dead
 * button, and a false "changed" nags about whitespace nobody typed.
 */
{
	const stored = [goal('g1', W1, 'Ch. 1', 0, true), goal('g2', W1, 'Ch. 2', 1)];
	const asBoxes = { [W1]: 'Ch. 1\nCh. 2' };
	const base = planFingerprint([W1], asBoxes);

	/** Does planDiff want to write anything for these boxes? */
	const diffIsEmpty = (boxes: Record<string, string>, weekList = [W1]) => {
		const d = planDiff(
			weekList.map((w) => ({ week_start: w, lines: (boxes[w] ?? '').split('\n') })),
			stored,
			CTX
		);
		return !d.toInsert.length && !d.toDelete.length && !d.toUpsert.length;
	};

	const agree = (name: string, boxes: Record<string, string>, weekList = [W1]) => {
		const clean = planFingerprint(weekList, boxes) === base;
		check(name, clean === diffIsEmpty(boxes, weekList),
			clean ? 'called it unchanged, but planDiff would write' : 'called it changed, but planDiff would not');
	};

	console.log('\nSave stays greyed out exactly when planDiff would do nothing:');
	agree('untouched boxes', { [W1]: 'Ch. 1\nCh. 2' });
	agree('a trailing newline', { [W1]: 'Ch. 1\nCh. 2\n' });
	agree('blank lines between goals', { [W1]: 'Ch. 1\n\n\nCh. 2\n\n' });
	agree('spaces around a title', { [W1]: '  Ch. 1  \n\tCh. 2 ' });
	agree('an edited title', { [W1]: 'Ch. 1 revised\nCh. 2' });
	agree('a new goal', { [W1]: 'Ch. 1\nCh. 2\nCh. 3' });
	agree('a deleted goal', { [W1]: 'Ch. 1' });
	agree('everything cleared', { [W1]: '' });
	agree('reordered goals', { [W1]: 'Ch. 2\nCh. 1' });

	// An imported plan can push the box list past the week range that was
	// loaded; empty new weeks are not an edit, a filled one is.
	const wideBase = planFingerprint([W1, W2], asBoxes);
	check(
		'an empty week appended by an import is not a change',
		wideBase === base,
		'an empty week counted as an edit'
	);
	check(
		'a filled week appended by an import is a change',
		planFingerprint([W1, W2], { ...asBoxes, [W2]: 'Ch. 3' }) !== base
	);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
