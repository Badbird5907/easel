/**
 * Course smart search (COURSE-6), owned by the Course content and communication
 * workstream.
 *
 * Shapes: app/controllers/smart_search_controller.rb (a `results` wrapper),
 * lib/api/v1/search_result.rb. BIO 201 has IgniteAI Search turned on: its
 * `smart_search` feature flag is enabled and the endpoint answers. Every other
 * course answers 403, as Canvas does when the feature is off, so Easel falls
 * back to searching titles.
 *
 * The fake matches words and a few related terms instead of embeddings, which is
 * enough to show results that don't share the query's exact words.
 */
import { BASE } from '../data.mjs';
import { paginate } from './core.mjs';

const SMART_COURSES = new Set(['201']);

/** Searchable content in BIO 201, with IDs from course-content.mjs and discussions.mjs. */
const content = [
  {
    type: 'Assignment',
    id: '9003',
    title: 'Lab Report: Osmosis',
    url: '/courses/201/assignments/9003',
    body: 'Write up the potato core osmosis lab: mass change in sucrose solutions, error bars, and discussion.',
  },
  {
    type: 'Assignment',
    id: '9101',
    title: 'Lab Report: Diffusion',
    url: '/courses/201/assignments/9101',
    body: 'Agar cubes of three sizes: how surface area to volume ratio limits diffusion.',
  },
  {
    type: 'Assignment',
    id: '9102',
    title: 'Lab Report: Photosynthesis',
    url: '/courses/201/assignments/9102',
    body: 'Measure oxygen production by Elodea under three light intensities.',
  },
  {
    type: 'WikiPage',
    id: '2011',
    title: 'Osmosis lab guide',
    url: '/courses/201/pages/osmosis-lab-guide',
    body: 'You will measure the change in mass of potato cores after 30 minutes in sucrose solutions.',
  },
  {
    type: 'WikiPage',
    id: '2013',
    title: 'Photosynthesis overview',
    url: '/courses/201/pages/photosynthesis-overview',
    body: 'Light reactions happen in the thylakoid membranes; the Calvin cycle runs in the stroma.',
  },
  {
    type: 'WikiPage',
    id: '2014',
    title: 'Lab safety rules',
    url: '/courses/201/pages/lab-safety-rules',
    body: 'Goggles on whenever chemicals are out. No food or drink at the bench. Report every spill.',
  },
  {
    type: 'WikiPage',
    id: '2012',
    title: 'Week 2 reading checklist',
    url: '/courses/201/pages/reading-checklist',
    body: 'Chapter 7: membrane structure, passive transport, and active transport.',
  },
  {
    type: 'DiscussionTopic',
    id: '8101',
    title: 'Week 9: Membrane transport questions',
    url: '/courses/201/discussion_topics/8101',
    body: 'Post questions about this week’s reading. Think about which direction water moves when the solute can’t cross.',
  },
  {
    type: 'DiscussionTopic',
    id: '8104',
    title: 'Debate: is a virus alive?',
    url: '/courses/201/discussion_topics/8104',
    body: 'Take a side and defend it with one property of life from Chapter 1.',
  },
  {
    type: 'Announcement',
    id: '7002',
    title: 'Lab section moved to Room 214',
    url: '/courses/201/announcements/7002',
    body: 'Thursday’s lab meets in Room 214 while the main lab is being renovated.',
  },
];

/** Words that should find each other, standing in for semantic matching. */
const related = {
  water: ['osmosis', 'solute', 'hypotonic'],
  osmosis: ['water', 'solute', 'potato'],
  membrane: ['transport', 'diffusion', 'channel'],
  diffusion: ['membrane', 'agar', 'surface'],
  plants: ['photosynthesis', 'elodea', 'light'],
  plant: ['photosynthesis', 'elodea', 'light'],
  light: ['photosynthesis'],
  safety: ['goggles', 'spill'],
  goggles: ['safety'],
  room: ['lab', 'moved'],
  virus: ['life', 'alive'],
};

const words = (text) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function score(item, query) {
  const haystack = new Set(words(`${item.title} ${item.body}`));
  const title = new Set(words(item.title));
  let total = 0;
  for (const w of words(query)) {
    if (title.has(w)) total += 3;
    else if (haystack.has(w)) total += 2;
    else if ((related[w] ?? []).some((r) => haystack.has(r))) total += 1;
  }
  return total;
}

export const routes = [
  {
    // Course feature flags (feature_flags_controller.rb#enabled_features).
    path: '/api/v1/courses/:courseId/features/enabled',
    handler: ({ params }) => [
      ...(SMART_COURSES.has(params.courseId) ? ['smart_search', 'discussion_checkpoints'] : []),
      ...(['241', '225', '201', '110'].includes(params.courseId) ? ['student_outcome_gradebook'] : []),
    ],
  },
  {
    path: '/api/v1/courses/:courseId/smartsearch',
    handler: ({ params, query, url }) => {
      if (!SMART_COURSES.has(params.courseId))
        return {
          status: 403,
          body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
        };
      const q = String(query.q ?? '').trim();
      if (!q) return { status: 400, body: { error: "missing 'q' param" } };
      const filters = new Set([].concat(query.filter ?? []));
      const typeFilter = { pages: 'WikiPage', assignments: 'Assignment', announcements: 'Announcement', discussion_topics: 'DiscussionTopic' };
      const max = words(q).length * 3 || 1;
      const results = content
        .filter((item) => !filters.size || [...filters].some((f) => typeFilter[f] === item.type))
        .map((item) => ({ item, s: score(item, q) }))
        .filter(({ s }) => s > 0)
        .sort((a, b) => b.s - a.s)
        .map(({ item, s }) => ({
          content_id: item.id,
          content_type: item.type,
          readable_type: { WikiPage: 'page', Assignment: 'assignment', DiscussionTopic: 'discussion', Announcement: 'announcement' }[item.type],
          title: item.title,
          body: item.body,
          html_url: `${BASE}${item.url}`,
          distance: Math.round((1 - s / max) * 100) / 100,
          relevance: Math.min(100, Math.round((s / max) * 100)),
        }));
      const page = paginate(results, query, url);
      return { ...page, body: { results: page.body } };
    },
  },
];
