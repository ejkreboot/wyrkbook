/**
 * How hard the trimmer cuts an exercise set. Shared by the assignment editor
 * (labels) and the server (the prompt text for each level, in
 * $lib/server/trimPrompt). Ordered from the lightest cut to the heaviest.
 *
 * `keep` is a guide for the lesson's own practice problems, not a quota, and
 * review problems are outside it altogether — see the prompt.
 */
export const TRIM_LEVELS = [
	{ id: 'light', label: 'Light', keep: 'about three quarters', hint: 'Drop only the obvious repeats.' },
	{ id: 'moderate', label: 'Moderate', keep: 'about half', hint: 'Two of each kind of problem.' },
	{ id: 'heavy', label: 'Heavy', keep: 'about a third', hint: 'One of each kind, leaning to the harder ones.' },
	{ id: 'minimal', label: 'Minimal', keep: 'about a fifth', hint: 'Each skill once — a quick check, not practice.' }
] as const;

export type TrimLevel = (typeof TRIM_LEVELS)[number]['id'];

export const DEFAULT_TRIM_LEVEL: TrimLevel = 'moderate';

export function isTrimLevel(v: unknown): v is TrimLevel {
	return TRIM_LEVELS.some((l) => l.id === v);
}

export function trimLevelInfo(level: TrimLevel) {
	return TRIM_LEVELS.find((l) => l.id === level)!;
}

// Remembered per class, like the outline's sparseness: how much drill a student
// needs is a property of the student and the subject, not of one assignment.
const levelKey = (classId: string) => `wyrkbook:trim-level:${classId}`;

export function rememberedTrimLevel(classId: string): TrimLevel {
	try {
		const saved = localStorage.getItem(levelKey(classId));
		return isTrimLevel(saved) ? saved : DEFAULT_TRIM_LEVEL;
	} catch {
		return DEFAULT_TRIM_LEVEL;
	}
}

export function rememberTrimLevel(classId: string, level: TrimLevel) {
	try {
		localStorage.setItem(levelKey(classId), level);
	} catch {
		// Private window or blocked storage: it just won't be remembered.
	}
}
