/**
 * How much of an outline the generator writes for the student. Shared by the
 * editor (labels) and the server (the prompt text for each level, in
 * $lib/server/outlinePrompt). Ordered from most to least hand-holding.
 *
 * The photos are always outlined at the first level, Guided, which every other
 * level can be cut down from; the level the teacher picked is a rewrite of it.
 */
export const OUTLINE_LEVELS = [
	{ id: 'guided', label: 'Guided', hint: 'Full structure, many fill-in blanks. Early in the term.' },
	{ id: 'standard', label: 'Standard', hint: 'Topic prompts with space to write; blanks for key terms.' },
	{ id: 'sparse', label: 'Sparse', hint: 'Main points only; students organize the rest.' },
	{ id: 'skeletal', label: 'Skeletal', hint: 'Section and subsection titles with room to write.' }
] as const;

export type OutlineLevel = (typeof OUTLINE_LEVELS)[number]['id'];

export const DEFAULT_OUTLINE_LEVEL: OutlineLevel = 'standard';

export function isOutlineLevel(v: unknown): v is OutlineLevel {
	return OUTLINE_LEVELS.some((l) => l.id === v);
}

export function levelInfo(level: OutlineLevel) {
	return OUTLINE_LEVELS.find((l) => l.id === level)!;
}

// Sparseness is remembered per class: it moves with the term, one class at a time.
const levelKey = (classId: string) => `wyrkbook:outline-level:${classId}`;

export function rememberedLevel(classId: string): OutlineLevel {
	try {
		const saved = localStorage.getItem(levelKey(classId));
		return isOutlineLevel(saved) ? saved : DEFAULT_OUTLINE_LEVEL;
	} catch {
		return DEFAULT_OUTLINE_LEVEL;
	}
}

export function rememberLevel(classId: string, level: OutlineLevel) {
	try {
		localStorage.setItem(levelKey(classId), level);
	} catch {
		// Private window or blocked storage: it just won't be remembered.
	}
}
