/**
 * A stable summary of what the planner's text boxes say.
 *
 * The planner compares the live boxes against the last thing the server sent to
 * decide whether Save plan has anything to do. That decision has to agree with
 * `planDiff`, which is what actually runs on save: if this said "changed" where
 * planDiff finds nothing, the button would nag over stray whitespace, and if it
 * said "unchanged" where planDiff would write, the teacher would lose an edit to
 * a greyed-out button. So it normalizes exactly the way planDiff does — trim
 * every line, drop the blank ones, and treat a week with nothing left in it as
 * no week at all.
 *
 * Lives outside `$lib/server` because the planner runs it in the browser on
 * every keystroke. `npm run test:plan` checks it against planDiff directly.
 */
export function planFingerprint(weeks: string[], boxes: Record<string, string>): string {
	return JSON.stringify(
		weeks
			.map((w) => [w, (boxes[w] ?? '').split('\n').map((l) => l.trim()).filter(Boolean)])
			.filter(([, lines]) => lines.length)
	);
}
