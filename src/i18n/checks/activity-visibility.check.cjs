/* global __dirname */
// Actual API/presentation with synthetic transport and in-memory query hydration only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const { QueryClient, dehydrate, hydrate } = require('@tanstack/react-query');
const root = path.resolve(__dirname, '../..');
const before = process.env.ACTIVITY_VISIBILITY_BEFORE === '1';
const cache = new Map();
let account = 'A';
const queries = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
const denied = (name) => () => {
  throw Error('Denied effect: ' + name);
};
global.fetch = denied('fetch');
let observedKey;
function load(name, parent = path.join(root, 'entry.ts')) {
  if (name === 'react') return require('react');
  const key = name.startsWith('.')
    ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name))
    : name;
  if (key === '@/canvas/query')
    return {
      useCanvasQuery(key, fetcher) {
        observedKey = [account, ...key];
        return { data: queries.getQueryData(observedKey), fetcher };
      },
    };
  assert.match(
    key,
    /^@\/(canvas\/(api\/activity|html)|features\/activity\/(activityVisibility|activityPresentation)|features\/offline\/json|lib\/dates|i18n($|\/))/,
  );
  const file = ['.ts', '.tsx', '/index.ts']
    .map((ext) => path.join(root, key.slice(2)) + ext)
    .find(fs.existsSync);
  assert.ok(file, key);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const source =
    before && key === '@/canvas/api/activity'
      ? fs.readFileSync(
          '/tmp/easel-scratch/localization/activity-visibility-before/activity.ts',
          'utf8',
        )
      : fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)((n) => load(n, file), m, m.exports);
  return m.exports;
}
const api = load('@/canvas/api/activity');
const presentation = load('@/features/activity/activityPresentation');
const { createTranslator } = load('@/i18n');
const { encodeJson, decodeJson } = load('@/features/offline/json');
const now = new Date().toISOString();
const stream = (extra = {}) => ({
  id: 'stream',
  type: 'Submission',
  title: 'Raw 91 name',
  message: null,
  created_at: now,
  updated_at: now,
  read_state: false,
  course_id: 'c',
  score: 8,
  grade: '8',
  workflow_state: 'graded',
  assignment: {
    id: 'a',
    name: 'Raw 91 name',
    points_possible: 10,
    grading_type: 'points',
    restrict_quantitative_data: true,
  },
  ...extra,
});
const grade = (extra = {}) => ({
  id: 'g',
  assignment_id: 'a',
  graded_at: now,
  score: 8,
  grade: '8',
  course: { id: 'c' },
  assignment: {
    id: 'a',
    name: 'Raw 91 name',
    course_id: 'c',
    points_possible: 10,
    grading_type: 'points',
    restrict_quantitative_data: true,
  },
  ...extra,
});
const client = (items, grades, log = []) => ({
  async getAll(p, params, options) {
    log.push([p, params, options]);
    assert.equal(p, '/api/v1/users/self/activity_stream');
    return items;
  },
  async get(p, params, signal) {
    log.push([p, params, signal]);
    assert.equal(p, '/api/v1/users/self/graded_submissions', 'no additional policy lookup');
    return grades;
  },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function neutral(item) {
  assert.equal(item.preview, 'Graded');
  assert.deepEqual(item.generatedPreview, { kind: 'graded' });
  for (const locale of ['en-US', 'fr-CA', 'ar-EG']) {
    const t = createTranslator(locale);
    assert.equal(
      presentation.activityPresentationText(item, t, locale).preview,
      t('activityPresentation.graded'),
    );
  }
}
async function main() {
  if (before) {
    const exposed = [
      api.toActivityItem(stream()),
      ...(await api.fetchActivity(
        client(
          [],
          [
            grade(),
            grade({
              id: 'fallback',
              course: { id: 'c', restrict_quantitative_data: true },
              grade: null,
            }),
          ],
        ),
      )),
    ];
    assert.deepEqual(
      exposed.map((i) => i.preview),
      ['Scored 8 out of 10', 'Scored 8 out of 10', 'Scored 8 out of 10'],
    );
    for (const item of exposed) assert.equal(item.generatedPreview.kind, 'scored');
    console.log(
      'BEFORE confirmed: stream assignment policy ignored; graded submission assignment policy ignored; restricted missing grade falls through; raw preview and provenance expose 8/10.',
    );
    return;
  }
  const baselinePath = process.env.ACTIVITY_VISIBILITY_CATALOG_BASELINE;
  const baseline = baselinePath ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  for (const lang of ['en', 'fr', 'ar']) {
    if (!baseline) continue;
    const catalog = load('@/i18n/' + lang)[lang];
    assert.equal(Object.keys(baseline.catalogs[lang]).length, 3225);
    for (const [key, hash] of Object.entries(baseline.catalogs[lang]))
      assert.equal(
        crypto.createHash('sha256').update(JSON.stringify(catalog[key])).digest('hex'),
        hash,
        lang + '/' + key,
      );
  }
  neutral(api.toActivityItem(stream()));
  neutral((await api.fetchActivity(client([], [grade()])))[0]);
  for (const restrict_quantitative_data of [undefined, null, true, 'false']) {
    for (const grading_type of ['points', 'percent', 'gpa_scale', undefined]) {
      const assignment = {
        id: 'a',
        course_id: 'c',
        points_possible: 10,
        grading_type,
        restrict_quantitative_data,
      };
      for (const rawGrade of ['8', 'A', null]) {
        neutral(api.toActivityItem(stream({ assignment, grade: rawGrade })));
        neutral((await api.fetchActivity(client([], [grade({ assignment, grade: rawGrade })])))[0]);
      }
    }
  }
  for (const grading_type of ['letter_grade', 'pass_fail']) {
    for (const value of ['A−', 'complete', '4', 'Scored 8 out of 10']) {
      const assignment = { ...grade().assignment, grading_type };
      const result = (
        await api.fetchActivity(client([], [grade({ assignment, grade: value })]))
      )[0];
      assert.deepEqual(
        result.generatedPreview,
        { kind: 'grade', grade: value },
        'categorical schema, never text guessing',
      );
      assert.equal(
        api.toActivityItem(stream({ assignment, grade: value })).preview,
        `Graded: ${value}`,
      );
    }
    neutral(
      (
        await api.fetchActivity(
          client([], [grade({ assignment: { ...grade().assignment, grading_type }, grade: null })]),
        )
      )[0],
    );
  }
  for (const grading_type of ['points', 'percent', 'gpa_scale', 'letter_grade', 'pass_fail']) {
    const assignment = { ...grade().assignment, grading_type, restrict_quantitative_data: false };
    const result = (await api.fetchActivity(client([], [grade({ assignment, grade: 'A' })])))[0];
    assert.equal(
      result.preview,
      ['letter_grade', 'pass_fail'].includes(grading_type) ? 'Graded: A' : 'Scored 8 out of 10',
    );
    assert.equal(api.toActivityItem(stream({ assignment })).preview, 'Scored 8 out of 10');
    const zero = (
      await api.fetchActivity(
        client(
          [],
          [grade({ assignment: { ...assignment, points_possible: 0 }, score: 0, grade: null })],
        ),
      )
    )[0];
    assert.equal(zero.preview, 'Scored 0 out of 0');
  }
  neutral(
    (
      await api.fetchActivity(
        client(
          [],
          [
            grade({
              course: { id: 'c', restrict_quantitative_data: true },
              assignment: { ...grade().assignment, restrict_quantitative_data: false },
              grade: null,
            }),
          ],
        ),
      )
    )[0],
  );
  const stripped = grade({ score: undefined, grade: undefined });
  assert.deepEqual(
    await api.fetchActivity(
      client(
        [],
        [
          grade({
            score: 8,
            grade: null,
            assignment: {
              ...grade().assignment,
              points_possible: null,
              restrict_quantitative_data: false,
            },
          }),
        ],
      ),
    ),
    [],
    'ordinary incomplete scores do not create new activity',
  );
  neutral(api.toActivityItem(stream({ assignment: null })));
  neutral((await api.fetchActivity(client([], [grade({ assignment: null })])))[0]);
  assert.deepEqual(
    await api.fetchActivity(client([], [stripped])),
    [],
    'unposted score absence still omitted',
  );
  assert.equal(
    (await api.fetchActivity(client([], [grade({ excused: true })])))[0].preview,
    'Excused',
  );
  for (const author_name of [undefined, '', 'Comment', 'Scored 8 out of 10']) {
    const comment = api.toActivityItem(
      stream({ submission_comments: [{ author_name, comment: 'Raw 99% comment' }] }),
    );
    const expected = `${author_name ?? 'Comment'}: Raw 99% comment`.trim();
    assert.equal(comment.preview, expected);
    assert.equal(comment.title, 'Raw 91 name');
    for (const locale of ['en-US', 'fr-CA', 'ar-EG']) {
      const t = createTranslator(locale);
      assert.equal(
        presentation.activityPresentationText(comment, t, locale).preview,
        author_name == null ? `${t('activityPresentation.comment')}: Raw 99% comment` : expected,
      );
    }
  }
  const announcement = stream({
    id: 'announcement',
    type: 'Announcement',
    message: 'Scored 8 out of 10',
    announcement_id: 'topic',
  });
  const log = [],
    signal = new AbortController().signal;
  const sorted = await api.fetchActivity(
    client(
      [stream(), announcement],
      [
        grade(),
        grade({
          id: 'other',
          assignment_id: 'other',
          graded_at: new Date(Date.now() - 1000).toISOString(),
        }),
      ],
      log,
    ),
    signal,
  );
  assert.deepEqual(
    sorted.map((i) => i.id),
    ['stream', 'announcement', 'grade:other'],
  );
  assert.deepEqual(sorted[0].target, { kind: 'assignment', courseId: 'c', assignmentId: 'a' });
  assert.equal(sorted[0].unread, true);
  assert.equal(sorted[1].preview, 'Scored 8 out of 10');
  assert.deepEqual(log[0][1], { only_active_courses: true });
  assert.equal(log[0][2].signal, signal);
  assert.equal(log[0][2].maxPages, 2);
  assert.equal(log[1][2], signal);
  assert.deepEqual(log[1][1].include, ['assignment', 'course']);
  // A missing policy never triggers a cross-account/shared lookup. Delayed policy-bearing
  // submissions remain owned by their transport; a failed grades endpoint leaves stream intact.
  const waitA = deferred(),
    waitB = deferred();
  const taskA = api.fetchActivity(client([stream()], waitA.promise));
  const taskB = api.fetchActivity(
    client(
      [
        stream({
          id: 'B',
          assignment: { ...stream().assignment, restrict_quantitative_data: false },
        }),
      ],
      waitB.promise,
    ),
  );
  waitB.reject(Error('synthetic policy-bearing endpoint failure'));
  assert.equal((await taskB)[0].preview, 'Scored 8 out of 10');
  waitA.resolve([
    grade({
      assignment_id: 'delayed',
      assignment: { ...grade().assignment, restrict_quantitative_data: undefined },
    }),
  ]);
  const itemsA = await taskA;
  itemsA.forEach(neutral);
  // Old records cannot distinguish generated text from user comments. Never parse or copy
  // the unversioned cache into the policy-safe query; retain prefix invalidation semantics.
  const oldItems = [stream(), stream({ id: 'comment' })].map((raw, index) => ({
    ...api.toActivityItem(raw),
    preview: index ? 'Teacher: 99%' : 'Scored 8 out of 10',
    generatedPreview: undefined,
  }));
  const persisted = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  oldItems.push({
    ...oldItems[0],
    id: 'legacy-generated-score',
    generatedPreview: { kind: 'scored', score: 8, points: 10 },
  });
  oldItems.push({
    ...oldItems[0],
    id: 'legacy-generated-grade',
    preview: 'Graded: 8',
    generatedPreview: { kind: 'grade', grade: '8' },
  });
  persisted.setQueryData(['A', 'activity'], oldItems);
  persisted.setQueryData(['B', 'activity'], oldItems);
  hydrate(queries, decodeJson(encodeJson(dehydrate(persisted))));
  assert.equal(
    api.useActivity().data,
    undefined,
    'legacy cache must not enter current screen, even offline',
  );
  assert.deepEqual(observedKey, ['A', 'activity', 'visibility-v2']);
  queries.setQueryData(observedKey, itemsA);
  assert.equal(api.useActivity().data, itemsA);
  await queries.invalidateQueries({ queryKey: ['A', 'activity'], refetchType: 'none' });
  assert.equal(queries.getQueryState(observedKey).isInvalidated, true);
  account = 'B';
  assert.equal(api.useActivity().data, undefined);
  assert.deepEqual(observedKey, ['B', 'activity', 'visibility-v2']);
  account = 'A';
  assert.equal(api.useActivity().data, itemsA);
  assert.equal(
    queries.getQueryData(['A', 'activity'])[1].preview,
    'Teacher: 99%',
    'migration never rewrites ambiguous user text',
  );
  const restored = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  hydrate(restored, decodeJson(encodeJson(dehydrate(queries))));
  const safeCached = restored.getQueryData(['A', 'activity', 'visibility-v2']);
  safeCached.forEach(neutral);
  assert.ok(safeCached[0].updatedAt instanceof Date);
  queries.clear();
  persisted.clear();
  restored.clear();
  console.log(
    'Activity visibility: actual API/presentation, restricted/ordinary schemas, fail-closed missing policy, raw comments, delayed/failed account transports, dedup/sort/routing, legacy cache exclusion and prefix invalidation passed; synthetic effects only.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
