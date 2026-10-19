/**
 * How much room to leave below a problem for the student to work it — the
 * guidance shared by extraction (/api/extract), which sizes problems as it
 * reads them, and /api/work-space, which sizes a list from the editor.
 */
import { MAX_WORK_LINES, WORK_LINE_MM } from '../workSpace.ts';

export const WORK_SPACE_GUIDANCE = `\`work_lines\` is how much room to leave below the exercise for the student
to work it by hand on the printed sheet, in lines about ${WORK_LINE_MM}mm tall. Judge it
from what working the exercise takes, not from how long its text is: think
through the solution a student at this level would write out — one line per
step, plus a line for the answer — without writing it down. As a guide:
- 0 when the answer is a word or number with no work to show (a vocabulary
  question, true or false, reading a value off a figure).
- 2 to 3 for a one- or two-step computation.
- 4 to 7 for a multi-step equation, simplification or factoring.
- 8 to 12 for a word problem that needs a setup, a system of equations, or a
  justification in sentences.
- 10 to 14 for a graph or figure the student draws, enough for the axes.
- Exercises with parts (a), (b), (c): room for each part, added up.
Never more than ${MAX_WORK_LINES}. Err a little generous: crowded work is hard to grade.`;
