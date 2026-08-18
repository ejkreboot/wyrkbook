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

export type AssignmentStatus = 'draft' | 'published' | 'archived';

export type Assignment = {
	id: string;
	org_id: string;
	class_id: string;
	title: string;
	instructions: string | null;
	week_start: string | null;
	status: AssignmentStatus;
	answer_key: string | null;
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
	answer: string | null;
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
