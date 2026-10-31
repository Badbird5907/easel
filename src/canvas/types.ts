/**
 * Raw Canvas API shapes, trimmed to the fields Easel reads. Requests send
 * `Accept: application/json+canvas-string-ids`, so IDs arrive as strings.
 * Field lists follow canvas-lms serializers (paths in each comment).
 */

/** `GET /api/v1/users/self` (lib/api/v1/user.rb) */
export type CanvasUser = {
  id: string;
  name: string;
  short_name?: string;
  sortable_name?: string;
  avatar_url?: string | null;
  locale?: string | null;
  effective_locale?: string;
};

/** `GET /api/v1/dashboard/dashboard_cards` (app/presenters/course_for_menu_presenter.rb) */
export type CanvasDashboardCard = {
  id: string;
  shortName: string;
  originalName: string;
  courseCode: string;
  assetString: string;
  href: string;
  term?: string | null;
  isFavorited?: boolean;
  image?: string | null;
  color?: string | null;
  position?: number | null;
  enrollmentType?: string;
};

/** `GET /api/v1/users/self/colors` */
export type CanvasCustomColors = { custom_colors: Record<string, string> };

/** `GET /api/v1/courses/:id` (lib/api/v1/course_json.rb) */
export type CanvasCourse = {
  id: string;
  name: string;
  course_code: string;
  original_name?: string;
  default_view?: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus';
  hide_final_grades?: boolean;
  /** Letters only: the student may not see points or percentages. */
  restrict_quantitative_data?: boolean;
  image_download_url?: string | null;
  enrollments?: {
    type: string;
    role?: string;
    computed_current_score?: number | null;
    computed_current_grade?: string | null;
    computed_final_score?: number | null;
    computed_final_grade?: string | null;
  }[];
  teachers?: { id: string; display_name: string; avatar_image_url?: string }[];
  term?: { id: string; name: string; start_at?: string | null; end_at?: string | null };
};

export type CanvasPlannableType =
  | 'discussion_topic'
  | 'announcement'
  | 'quiz'
  | 'assignment'
  | 'wiki_page'
  | 'planner_note'
  | 'calendar_event'
  | 'assessment_request'
  | 'sub_assignment'
  | 'peer_review_sub_assignment';

/** `GET /api/v1/planner/items` (lib/api/v1/planner_item.rb) */
export type CanvasPlannerItem = {
  plannable_id: string;
  plannable_type: CanvasPlannableType;
  plannable_date: string;
  context_type?: 'Course' | 'Group' | 'User';
  course_id?: string;
  group_id?: string;
  context_name?: string;
  html_url?: string;
  new_activity?: boolean;
  planner_override?: {
    id: string;
    marked_complete: boolean;
    dismissed: boolean;
  } | null;
  submissions?:
    | false
    | {
        submitted?: boolean;
        excused?: boolean;
        graded?: boolean;
        late?: boolean;
        missing?: boolean;
        needs_grading?: boolean;
        has_feedback?: boolean;
        redo_request?: boolean;
      };
  plannable: {
    id: string;
    title: string;
    points_possible?: number | null;
    due_at?: string | null;
    todo_date?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    all_day?: boolean;
    details?: string | null;
    course_id?: string | null;
    assignment_id?: string | null;
    read_state?: 'read' | 'unread';
    unread_count?: number;
  };
};

/** `GET /api/v1/announcements` (lib/api/v1/discussion_topics.rb) */
export type CanvasDiscussionTopic = {
  id: string;
  title: string;
  message: string | null;
  html_url: string;
  posted_at: string | null;
  delayed_post_at?: string | null;
  read_state?: 'read' | 'unread';
  unread_count?: number;
  context_code?: string;
  author?: { id?: string; display_name?: string; avatar_image_url?: string | null } | null;
  user_name?: string;
  attachments?: CanvasAttachment[];
};

/** File and attachment JSON (lib/api/v1/attachment.rb) */
export type CanvasAttachment = {
  id: string;
  display_name: string;
  filename: string;
  'content-type': string;
  url: string;
  size: number;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  locked?: boolean;
  locked_for_user?: boolean;
  created_at?: string;
  updated_at?: string;
  modified_at?: string;
};
