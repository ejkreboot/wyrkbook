export type Role = 'sysadmin' | 'admin' | 'student';

export type Profile = {
	id: string;
	org_id: string | null;
	role: Role;
	display_name: string;
	email: string;
	created_at: string;
};

export type Organization = { id: string; name: string; created_at: string };

export type Klass = {
	id: string;
	org_id: string;
	name: string;
	subject: string | null;
	color: string;
	archived: boolean;
	created_at: string;
};

/**
 * A student's place on a class roster. The unique (class_id, student_id) pair is
 * the whole row's meaning; `org_id` is denormalized so RLS can scope it without
 * a join, the same way every other table here does.
 */
export type Enrollment = {
	id: string;
	org_id: string;
	class_id: string;
	student_id: string;
	created_at: string;
};

export type AssignmentStatus = 'draft' | 'published' | 'archived';

export type Assignment = {
	id: string;
	org_id: string;
	class_id: string;
	title: string;
	instructions: string | null;
	week_start: string | null;
	status: AssignmentStatus;
	hint_penalty: number;
	work_pages: number;
	created_by: string | null;
	created_at: string;
};

export type Problem = {
	id: string;
	org_id: string;
	assignment_id: string;
	label: string;
	body: string;
	points: number;
	included: boolean;
	sort_order: number;
	created_at: string;
};

export type WeeklyGoal = {
	id: string;
	org_id: string;
	class_id: string;
	week_start: string;
	title: string;
	detail: string | null;
	assignment_id: string | null;
	done: boolean;
	sort_order: number;
	created_at: string;
};

export type SubmissionStatus = 'in_progress' | 'submitted' | 'graded';

export type Submission = {
	id: string;
	org_id: string;
	assignment_id: string;
	student_id: string;
	status: SubmissionStatus;
	score: number | null;
	max_score: number | null;
	hint_penalty_total: number;
	feedback: string | null;
	submitted_at: string | null;
	graded_at: string | null;
	created_at: string;
};

export type ProblemResult = {
	id: string;
	submission_id: string;
	problem_id: string;
	student_work: string | null;
	correct: boolean | null;
	points_earned: number;
	feedback: string | null;
};

export type HintRequest = {
	id: string;
	submission_id: string;
	problem_id: string | null;
	student_id: string;
	storage_path: string | null;
	question: string | null;
	hint: string;
	penalty: number;
	created_at: string;
};

export type GradeSource = 'manual' | 'auto';

/**
 * A column in the gradebook. Either it stands for an assignment this app created
 * (`assignment_id` set, cells filled in by the grader) or the teacher typed it in
 * for work done outside the system (`assignment_id` null, cells typed by hand).
 * Nothing else distinguishes the two, which is why deleting an assignment only
 * nulls the link — the column carries on as the second kind.
 *
 * `points_possible` is the column's own denominator and does not track the
 * assignment's problems after the fact. Two students can be graded against
 * different problem sets if the teacher edited the assignment mid-week, and a
 * column has to mean one thing, so the sync rescales each submission onto this
 * number rather than letting the column drift.
 *
 * No due date, deliberately. See migration 007.
 */
export type GradeItem = {
	id: string;
	org_id: string;
	class_id: string;
	assignment_id: string | null;
	title: string;
	points_possible: number;
	sort_order: number;
	created_at: string;
};

/**
 * One cell: what this student earned on this item.
 *
 * `points_earned` is nullable and the null is load-bearing. The course total is
 * sum(earned)/sum(possible) over marked items only, so an unmarked cell is absent
 * from the arithmetic rather than a zero. A row that exists with a null is the
 * teacher having cleared it on purpose — which is what excused means here and,
 * being `source: 'manual'`, is protected from the grader.
 *
 * `source` is a precedence rule, not a label: 'manual' outranks 'auto' forever.
 */
export type Grade = {
	id: string;
	org_id: string;
	grade_item_id: string;
	student_id: string;
	points_earned: number | null;
	source: GradeSource;
	submission_id: string | null;
	updated_at: string;
	created_at: string;
};

/** Colors a class can be tagged with; each maps to a --c-<name> token in app.css. */
export const CLASS_COLORS = [
	'slate',
	'rose',
	'amber',
	'green',
	'teal',
	'blue',
	'violet',
	'brown'
] as const;

export type PlanImportStatus = 'running' | 'ready' | 'failed' | 'applied';

/** One AI read of a course document, proposed but not yet saved as goals. */
export type PlanImport = {
	id: string;
	org_id: string;
	class_id: string;
	created_by: string | null;
	file_name: string;
	guidance: string | null;
	week_start: string;
	status: PlanImportStatus;
	expires_at: string;
	notes: string | null;
	plan: { week_start: string; lines: string[] }[] | null;
	error: string | null;
	created_at: string;
	finished_at: string | null;
};

/**
 * Answers live apart from the rows students can read. See migration 004 — RLS is
 * row-level, so an `answer` column on `problem` is readable by anyone who can
 * read the problem.
 */
export type ProblemAnswer = { problem_id: string; org_id: string; answer: string | null };
export type AssignmentKey = { assignment_id: string; org_id: string; answer_key: string | null };
