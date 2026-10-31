import { QueryClient } from '@tanstack/react-query';
import { cacheCompletedQuiz, markSubmittedWork } from './submissionCache';
import type { QuizSubmission } from '@/canvas/api/quizzes';
const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ');
  },
};

const client = new QueryClient();
const item = { id: 'quiz:7', courseId: '1', status: 'missing', markedComplete: false };
for (const range of ['today', 'month']) client.setQueryData(['A', 'planner', 'items', range], [item, { ...item, courseId: '2' }]);
client.setQueryData(['B', 'planner', 'items'], [item]);
client.setQueryData(['A', 'planner', 'calendar'], { items: [{ ...item, done: false }], assignmentIds: ['9'] });
client.setQueryData(['A', 'planner', 'items', 'assignment'], [{ ...item, id: 'assignment:9' }]);
const key = ['A', 'courses', '1', 'quizzes', '7'];
client.setQueryData(key, { assignmentId: '9' });
const submission = { id: '4', attempt: 2, inProgress: false, attemptsLeft: 1, score: null, keptScore: null, workflowState: 'pending_review' } as QuizSubmission;
cacheCompletedQuiz(client, 'A', '1', '7', submission);
for (const range of ['today', 'month']) {
  const rows = client.getQueryData<any[]>(['A', 'planner', 'items', range])!;
  assert.equal(rows[0].status, 'submitted');
  assert.equal(rows[0].markedComplete, false);
  assert.equal(rows[1].status, 'missing');
}
assert.equal(client.getQueryData<any[]>(['A', 'planner', 'items', 'assignment'])![0].status, 'submitted');
assert.equal(client.getQueryData<any>(['A', 'planner', 'calendar']).items[0].done, true);
assert.equal(client.getQueryData<any[]>(['B', 'planner', 'items'])![0].status, 'missing');
assert.equal(client.getQueryData<any>([...key, 'attempts']).latestScore, null);
assert.equal(client.getQueryData<any>([...key, 'attempts']).pendingReview, true);
assert.deepEqual(client.getQueryData([...key, 'submissions', '4']), submission);
cacheCompletedQuiz(client, 'A', '1', '7', submission);
assert.equal(client.getQueryData<any[]>([...key, 'history'])!.length, 1);
assert.equal(client.getQueryState(['A', 'planner', 'items', 'today'])?.isInvalidated, true);
// A later authoritative read may reverse the optimistic state.
client.setQueryData(['A', 'planner', 'items', 'today'], [item]);
assert.equal(client.getQueryData<any[]>(['A', 'planner', 'items', 'today'])![0].status, 'missing');
markSubmittedWork(client, 'A', { courseId: '1', assignmentId: '9' });
console.log('Submission cache: ranges, course/account isolation, calendar, attempts, null scores, reconciliation passed');
client.clear();
