/** CONTENT-12. Shapes: Api::V1::Outcome and Api::V1::OutcomeResults.
 * 241: mixed results; 225: inherited 10-point scale; 201: grades denied;
 * 110: no outcomes. search.mjs supplies the feature flags; course-content.mjs
 * supplies the course tabs.
 */
import { user } from '../data.mjs';

function outcome(id, title, courseId, options = {}) {
  return {
    id, title, display_name: title, context_id: courseId, context_type: 'Course',
    vendor_guid: null, url: `/api/v1/outcomes/${id}`, can_edit: false,
    has_updateable_rubrics: false, description: '', friendly_description: null,
    points_possible: 5, mastery_points: 3, calculation_method: 'highest',
    ratings: [{ description: 'Exceeds mastery', points: 5 }, { description: 'Mastery', points: 3 }, { description: 'No evidence', points: 0 }],
    assessed: true, alignments: [], group_id: null, ...options,
  };
}
function score(id, value, count = 2, hide = false) {
  return { score: value, count, hide_points: hide, title: 'Outcome assessment', submitted_at: '2026-10-28T12:00:00Z', links: { outcome: id } };
}

export const routes = [{
  path: '/api/v1/courses/:courseId/outcome_rollups',
  handler: ({ params, query, url }) => {
    // Match server permission behavior: never return the whole class.
    if (!Array.isArray(query.user_ids) || query.user_ids.length !== 1 || query.user_ids[0] !== String(user.id))
      return { status: 403, body: { errors: [{ message: 'not authorized to read grades for specified users' }] } };
    const id = params.courseId;
    if (id === '201') return { status: 403, body: { errors: [{ message: 'not authorized to read grades for specified users' }] } };
    if (!['241', '225', '110'].includes(id)) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
    const outcomes = id === '110' ? [] : id === '225' ? [
      outcome('91201', 'Analyze algorithm efficiency', id, {
        points_possible: 10, mastery_points: 8, calculation_method: 'average',
        proficiency_context_type: 'Account', proficiency_context_id: '1',
        ratings: [{ description: 'Exceeds mastery', points: 10 }, { description: 'Mastery', points: 8 }, { description: 'Developing', points: 4 }, { description: 'No evidence', points: 0 }],
      }),
    ] : [
      outcome('91101', 'Interpret mathematical models', id),
      outcome('91102', 'Explain a proof', id, { calculation_method: 'latest' }),
      outcome('91103', 'Apply series tests', id, { assessed: false }),
      outcome('91104', 'Sustain mastery across assessments', id, { calculation_method: 'n_mastery', calculation_int: 3 }),
      outcome('91105', 'Communicate reasoning', id),
      outcome('91106', 'Reason from first principles', id),
    ];
    const scores = id === '110' ? [] : id === '225' ? [score('91201', 7.5)] : [
      score('91101', 4), score('91102', 2), score('91104', null, 2),
      score('91105', 4, 1, true), score('91106', 0, 1),
    ];
    // Pagination is by user, with all their outcome scores together. A student
    // enrolled in two sections can have duplicate rows, never separate pages.
    const rollup = { scores, links: { user: String(user.id), section: `${id}1`, status: 'active' } };
    const current = new URL(url);
    current.searchParams.set('page', '1');
    const currentUrl = current.toString();
    return {
      meta: { pagination: { per_page: Number(query.per_page) || 10, page: 1, count: 1, page_count: 1,
        current: currentUrl, first: currentUrl, last: currentUrl,
        template: currentUrl.replace('page=1', 'page={page}') } },
      rollups: [rollup, ...(id === '241' ? [{ ...rollup, links: { ...rollup.links, section: `${id}2` } }] : [])],
      ...(query.include?.includes('outcomes') ? { linked: { outcomes } } : {}),
    };
  },
}];
