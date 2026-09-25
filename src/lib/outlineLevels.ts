/**
 * How much of an outline the generator writes for the student. Shared by the
 * editor (labels) and the server (the prompt text for each level, in
 * $lib/server/outlinePrompt). Ordered from most to least hand-holding.
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
