---
name: textbook-outline
description: Turn phone photos (.heic or .jpeg or .jpg) of textbook pages into a sparse, fill-in-the-blank lecture outline in markdown format in the user's house style, including teacher notes with the blanks filled.
---

# Textbook pages → lecture outline

The outline is a note-taking scaffold for a student who fills it in during the parent's lecture. It must be **sparse**: guide the notetaking, don't spoon-feed. The student should learn the material *and* learn how to take notes.

## Markdown format
We use these conventions:

1. Outlining. Use ordered lists with the '- ` delimiter. Our formatting style converts these to hierarchical outline numbering. 
2. Use Katex (inline or section) for all math/formula notation. 
3. Teacher notes are included in double curly braces (`{{ }}``). Our renderer hides these for student handouts and shows them in blue text for teacher handouts.

## 1. Deciding the content

- **Skip**: sidebars, special boxes (e.g. "Hmm... Interesting."), worked examples set off by markers/boxes, figure captions, footnotes, and the tail of a section that started before these pages (unless it's substantial). Also skip opinion or devotional asides.
- **Top level (I., II., III.)** = the textbook's section numbers (e.g. Section 3.2 → `II.`, section 3.3 → `III.`). Top-level titles are the book's section titles. 
- **Subsections** (`X.Y.Z`) and main concepts → `a.`. Supporting points → `i.`, and at most `1.` below that. Don't go deeper.
- **Sparseness** (look at the example):
  - Most lines are short topic prompts ("Thermal equilibrium", "Conduction") followed by 1–3 blank writing lines (`"blanks"`).
  - Some lines are fill-in-the-blank sentences for key terms and facts. Write each missing word as 15 underscores, with the expected word(s) after the blanks in teacher note format (`{{ }}`).
  - Roughly 1–2 prompts per paragraph of textbook text. Leave definitions, explanations, and numbers for the student to write.
  - Plain wording in the parent's voice. No bold terms or emphasis beyond what the builder does.


