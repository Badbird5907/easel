/**
 * Self-check for the grade calculator against hand-computed examples.
 *
 *   pnpm exec tsx src/features/grades/calculate.check.ts
 *
 * Every expected number below was worked out by hand (the arithmetic is in the
 * comments) and follows canvas-lms CourseGradeCalculator semantics.
 */
import {
  applyWhatIf,
  type CalcAssignment,
  type CalcGroup,
  calculateCourseGrade,
  type CourseGrade,
  defaultGradingScheme,
  groupPercent,
  roundHalfUp,
  scoreToLetter,
  totalPercent,
} from './calculate';

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
}

const item = (
  id: string,
  pointsPossible: number,
  score: number | null,
  extra: Partial<NonNullable<CalcAssignment['submission']>> = {},
): CalcAssignment => ({
  id,
  pointsPossible,
  counts: true,
  submission: { score, excused: false, ...extra },
});

// Homework (40%, drop lowest 1):
//   h1 8/10, h2 5/10, h3 9/10, h4 excused, h5 ungraded.
// Exams (60%): e1 72/100, e2 ungraded, e3 graded but not posted (hidden).
const homework: CalcGroup = {
  id: 'hw',
  weight: 40,
  rules: { dropLowest: 1 },
  assignments: [
    item('1', 10, 8),
    item('2', 10, 5),
    item('3', 10, 9),
    item('4', 10, null, { excused: true }),
    item('5', 10, null),
  ],
};
const exams: CalcGroup = {
  id: 'ex',
  weight: 60,
  assignments: [item('6', 100, 72), item('7', 100, null), item('8', 100, null, { hidden: true })],
};

{
  const grade = calculateCourseGrade([homework, exams], { weightGroups: true });
  // Current homework: graded h1, h2, h3; dropping h2 keeps 17/20 = 85%.
  expect('current homework subtotal', groupPercent(grade.groups.hw.current), 85);
  expect('current homework drops h2', grade.groups.hw.current.dropped, ['2']);
  // Final homework: h5 counts as 0/10, so it is the one dropped: 22/30.
  expect('final homework drops h5', grade.groups.hw.final.dropped, ['5']);
  expect('final homework subtotal', groupPercent(grade.groups.hw.final), 73.33);
  // Current total: 0.85 × 40 + 0.72 × 60 = 34 + 43.2 = 77.2.
  expect('current total, weighted', totalPercent(grade.current, grade.unit), 77.2);
  // Final total: e3's grade isn't posted, so it counts as ungraded (zero), like e2:
  // 22/30 × 40 + 72/300 × 60 = 29.333 + 14.4 = 43.73.
  expect('final total, weighted', totalPercent(grade.final, grade.unit), 43.73);
  expect('unposted grade is left out of current', grade.groups.ex.current.possible, 100);
  expect('unposted grade counts as zero in final', grade.groups.ex.final.possible, 300);
}

{
  // Nothing graded in Exams yet: current reweights Homework to 100%: 34 / 40 × 100 = 85.
  const ungradedExams: CalcGroup = { ...exams, assignments: [item('6', 100, null), item('7', 100, null)] };
  const grade = calculateCourseGrade([homework, ungradedExams], { weightGroups: true });
  expect('current total reweights groups with nothing graded', totalPercent(grade.current, grade.unit), 85);
  // Final: 22/30 × 40 = 29.33, exams contribute 0.
  expect('final total counts empty groups as zero', totalPercent(grade.final, grade.unit), 29.33);
}

{
  // Unweighted: points add up across groups. Current 17 + 72 = 89 of 20 + 100 = 120 → 74.17%.
  const grade = calculateCourseGrade([homework, exams], { weightGroups: false });
  expect('current total, points', totalPercent(grade.current, grade.unit), 74.17);
  // Final: 22 + 72 = 94 of 30 + 300 = 330 → 28.48% (e2 and the unposted e3 count as zero).
  expect('final total, points', totalPercent(grade.final, grade.unit), 28.48);
}

{
  // What-if 90 on e2: exams 162/200 = 81%. Total 34 + 0.81 × 60 = 82.6.
  const grade = calculateCourseGrade(applyWhatIf([homework, exams], { '7': 90 }), { weightGroups: true });
  expect('what-if score recalculates the total', totalPercent(grade.current, grade.unit), 82.6);
  // A what-if on an excused item counts it: h4 = 10/10 joins homework. Keep 8, 9, 10 after dropping h2: 27/30.
  const excusedWhatIf = calculateCourseGrade(applyWhatIf([homework], { '4': 10 }), { weightGroups: true });
  expect('what-if replaces an excused submission', groupPercent(excusedWhatIf.groups.hw.current), 90);
}

{
  // Never drop h2: the drop moves to h1 (8/10), leaving 5 + 9 = 14/20 = 70%.
  const pinned = { ...homework, rules: { dropLowest: 1, neverDrop: ['2'] } };
  const grade = calculateCourseGrade([pinned], { weightGroups: true });
  expect('never-drop moves the drop', grade.groups.hw.current.dropped, ['1']);
  expect('never-drop subtotal', groupPercent(grade.groups.hw.current), 70);
}

{
  // Kane & Kane picks the best set, not the lowest percentage:
  // q1 1/2 (50%), q2 60/100 (60%), q3 9/10. Dropping q1 gives 69/110 = 62.7%;
  // dropping q2 gives 10/12 = 83.33%, which is better.
  const quizzes: CalcGroup = {
    id: 'q',
    weight: 100,
    rules: { dropLowest: 1 },
    assignments: [item('11', 2, 1), item('12', 100, 60), item('13', 10, 9)],
  };
  const grade = calculateCourseGrade([quizzes], { weightGroups: true });
  expect('drop picks the best combination', grade.groups.q.current.dropped, ['12']);
  expect('drop subtotal', groupPercent(grade.groups.q.current), 83.33);
  // Drop highest 1 instead: dropping q3 (90%) leaves 61/102 = 59.8%.
  const highest = calculateCourseGrade([{ ...quizzes, rules: { dropHighest: 1 } }], { weightGroups: true });
  expect('drop highest', highest.groups.q.current.dropped, ['13']);
}

{
  // Weighted grading periods, 40/60, with points inside each period.
  // P1: 9/10. P2 current: 6/10; P2 final: 6/20.
  // Current: 0.9 × 40 + 0.6 × 60 = 36 + 36 = 72. Final: 36 + 0.3 × 60 = 54.
  const group: CalcGroup = {
    id: 'g',
    weight: 0,
    assignments: [
      item('21', 10, 9, { gradingPeriodId: 'p1' }),
      item('22', 10, 6, { gradingPeriodId: 'p2' }),
      item('23', 10, null, { gradingPeriodId: 'p2' }),
    ],
  };
  const grade = calculateCourseGrade([group], {
    weightGroups: false,
    weightedPeriods: [
      { id: 'p1', weight: 40 },
      { id: 'p2', weight: 60 },
    ],
  });
  expect('weighted periods, current', totalPercent(grade.current, grade.unit), 72);
  expect('weighted periods, final', totalPercent(grade.final, grade.unit), 54);
}

{
  // An excused grade that isn't posted yet: the student sees no score and no excused flag,
  // so it's ungraded. Current leaves it out (9/10); final counts it as zero (9/20).
  const group: CalcGroup = {
    id: 'g',
    weight: 100,
    assignments: [item('31', 10, 9), item('32', 10, null, { excused: true, hidden: true })],
  };
  const grade = calculateCourseGrade([group], { weightGroups: true });
  expect('unposted excused, current', totalPercent(grade.current, grade.unit), 90);
  expect('unposted excused, final', totalPercent(grade.final, grade.unit), 45);
}

{
  // Weighted periods with nothing graded anywhere: no current total (Canvas stores nil), final 0.
  const group: CalcGroup = { id: 'g', weight: 100, assignments: [item('41', 10, null, { gradingPeriodId: 'p1' })] };
  const grade = calculateCourseGrade([group], {
    weightGroups: true,
    weightedPeriods: [
      { id: 'p1', weight: 50 },
      { id: 'p2', weight: 50 },
    ],
  });
  expect('weighted periods, nothing graded: no current total', totalPercent(grade.current, grade.unit), null);
  expect('weighted periods, nothing graded: final', totalPercent(grade.final, grade.unit), 0);
}

// MARK: - STAT 306, the fake Canvas grading course (devtools/fake-canvas/routes/assignment-grading.mjs)
//
// The groups below are what Easel's mapping makes of that course's JSON: unposted grades
// arrive without a score and map to `hidden`, pending review keeps its partial score.
// Group weights: Homework 25 (drop lowest 1, never drop 30605), Quizzes 15, Exams 40,
// Project 20. Periods: Term 1 (t1) weighs 40 and is closed, Term 2 (t2) weighs 60.
// The fake server computes the same totals with a port of the server's GradeCalculator.
{
  const t1 = { gradingPeriodId: 't1' };
  const t2 = { gradingPeriodId: 't2' };
  const stat306: CalcGroup[] = [
    {
      id: 'hw',
      weight: 25,
      rules: { dropLowest: 1, neverDrop: ['30605'] },
      assignments: [
        item('30601', 10, 9, t1),
        item('30602', 10, 7, t1), // late: entered 8, 1 point deducted
        item('30603', 10, 5, t1), // missing: 50% missing deduction
        item('30604', 10, null, { ...t2, excused: true }),
        item('30605', 10, 4, t2), // never dropped
        item('30606', 10, 10, t2),
        item('30607', 10, null, t2), // submitted, not graded
        item('30608', 10, null, t2), // not due yet
      ],
    },
    {
      id: 'quiz',
      weight: 15,
      assignments: [
        item('30611', 5, 5, t1), // pass/fail: complete
        item('30612', 5, 0, t1), // pass/fail: incomplete
        item('30613', 10, 8.9, t2), // letter grade B+
        item('30614', 10, 6, { ...t2, pendingReview: true }),
        item('30615', 10, null, { ...t2, hidden: true }), // graded, then hidden
      ],
    },
    {
      id: 'exam',
      weight: 40,
      assignments: [item('30621', 100, 82, t1), item('30622', 100, null, { ...t2, hidden: true })],
    },
    {
      id: 'project',
      weight: 20,
      assignments: [
        item('30631', 20, null, t2), // custom status "Needs revision", no score
        item('30632', 80, null, t2),
      ],
    },
  ];
  /** The groups as the API returns them for one period (`grading_period_id`), empty groups left out. */
  const inPeriod = (period: string) =>
    stat306
      .map((g) => ({ ...g, assignments: g.assignments.filter((a) => a.submission?.gradingPeriodId === period) }))
      .filter((g) => g.assignments.length > 0);
  const subtotals = (grade: CourseGrade, mode: 'current' | 'final') =>
    Object.fromEntries(Object.values(grade.groups).map((g) => [g.id, groupPercent(g[mode])]));
  const drops = (grade: CourseGrade, mode: 'current' | 'final') =>
    Object.values(grade.groups).flatMap((g) => g[mode].dropped);

  // Term 1: everything is graded, so current and final agree.
  //   Homework keeps the best 2 of 9, 7, 5: drops 30603 (5) → 16/20 = 80%.
  //   Quizzes 5/10 = 50%. Exams 82/100 = 82%. Project has nothing in Term 1.
  //   Weights in play total 80: (0.8 × 25 + 0.5 × 15 + 0.82 × 40) / 80 × 100 = 60.3 / 0.8 = 75.375 → 75.38.
  const term1 = calculateCourseGrade(inPeriod('t1'), { weightGroups: true });
  expect('STAT 306 Term 1 current', totalPercent(term1.current, term1.unit), 75.38);
  expect('STAT 306 Term 1 final', totalPercent(term1.final, term1.unit), 75.38);
  expect('STAT 306 Term 1 subtotals', subtotals(term1, 'current'), { hw: 80, quiz: 50, exam: 82 });
  expect('STAT 306 Term 1 drops', drops(term1, 'current'), ['30603']);

  // Term 2, current: graded work only.
  //   Homework: 30605 (4, never dropped) and 30606 (10). With one droppable score left the
  //   drop rule can't drop anything: 14/20 = 70%. Quizzes: only 30613 counts (pending review
  //   and unposted don't): 8.9/10 = 89%. Exams and Project: nothing graded, so they're left out.
  //   (0.7 × 25 + 0.89 × 15) / 40 × 100 = 30.85 / 0.4 = 77.125 → 77.13.
  const term2 = calculateCourseGrade(inPeriod('t2'), { weightGroups: true });
  expect('STAT 306 Term 2 current', totalPercent(term2.current, term2.unit), 77.13);
  expect('STAT 306 Term 2 current subtotals', subtotals(term2, 'current'), {
    hw: 70,
    quiz: 89,
    exam: null,
    project: null,
  });
  expect('STAT 306 Term 2 current drops nothing', drops(term2, 'current'), []);
  // Term 2, final: ungraded and unposted work counts as zero, pending review keeps its 6.
  //   Homework: 4 (pinned) + 10, 0, 0; drop one zero (30608, the later ID on a tie) → 14/30 = 46.67%.
  //   Quizzes: 8.9 + 6 + 0 = 14.9/30 = 49.67%. Exams 0/100. Project 0/100.
  //   14/30 × 25 + 14.9/30 × 15 = 11.667 + 7.45 = 19.117 → 19.12.
  expect('STAT 306 Term 2 final', totalPercent(term2.final, term2.unit), 19.12);
  expect('STAT 306 Term 2 final subtotals', subtotals(term2, 'final'), {
    hw: 46.67,
    quiz: 49.67,
    exam: 0,
    project: 0,
  });
  expect('STAT 306 Term 2 final drops', drops(term2, 'final'), ['30608']);

  // All periods, weighted 40/60, from the period totals:
  //   current 75.38 × 0.4 + 77.13 × 0.6 = 30.152 + 46.278 = 76.43.
  //   final   75.38 × 0.4 + 19.12 × 0.6 = 30.152 + 11.472 = 41.62.
  // Group subtotals add each period's kept points (each period drops on its own):
  //   Homework current 16 + 14 of 20 + 20 = 75%; final 16 + 14 of 20 + 30 = 60%.
  //   Quizzes current 5 + 8.9 of 20 = 69.5%; final 5 + 14.9 of 10 + 30 = 49.75%.
  //   Exams current 82%; final 82/200 = 41%. Project current none; final 0%.
  const periods = [
    { id: 't1', weight: 40 },
    { id: 't2', weight: 60 },
  ];
  const all = calculateCourseGrade(stat306, { weightGroups: true, weightedPeriods: periods });
  expect('STAT 306 all periods current', totalPercent(all.current, all.unit), 76.43);
  expect('STAT 306 all periods final', totalPercent(all.final, all.unit), 41.62);
  expect('STAT 306 all periods current subtotals', subtotals(all, 'current'), {
    hw: 75,
    quiz: 69.5,
    exam: 82,
    project: null,
  });
  expect('STAT 306 all periods final subtotals', subtotals(all, 'final'), {
    hw: 60,
    quiz: 49.75,
    exam: 41,
    project: 0,
  });
  expect('STAT 306 all periods current drops', drops(all, 'current'), ['30603']);
  expect('STAT 306 all periods final drops', drops(all, 'final'), ['30603', '30608']);

  // Letters from the default scheme, matching the server's computed grades.
  const letters = [75.38, 77.13, 19.12, 76.43, 41.62].map((p) => scoreToLetter(p, defaultGradingScheme));
  expect('STAT 306 letters', letters, ['C', 'C+', 'F', 'C', 'F']);

  // If the periods weren't weighted, "All periods" pools every assignment and drops once:
  //   Homework current keeps 9, 7, 10 + pinned 4 = 30/40 = 75%; final adds 0, 0, drops one: 35/60.
  //   Current (0.75 × 25 + 0.695 × 15 + 0.82 × 40) / 80 × 100 = 61.975 / 0.8 = 77.46875 → 77.47.
  //   Final 35/60 × 25 + 19.9/40 × 15 + 82/200 × 40 = 14.583 + 7.4625 + 16.4 = 38.446 → 38.45.
  const pooled = calculateCourseGrade(stat306, { weightGroups: true });
  expect('STAT 306 pooled current', totalPercent(pooled.current, pooled.unit), 77.47);
  expect('STAT 306 pooled final', totalPercent(pooled.final, pooled.unit), 38.45);
  expect('STAT 306 pooled final homework', groupPercent(pooled.groups.hw.final), 58.33);

  // What-if 95 on the unposted Exam 2 (what-ifs replace hidden grades): Term 2 current gains Exams.
  //   (0.7 × 25 + 0.89 × 15 + 0.95 × 40) / 80 × 100 = 68.85 / 0.8 = 86.0625 → 86.06.
  const whatIf = calculateCourseGrade(applyWhatIf(inPeriod('t2'), { '30622': 95 }), { weightGroups: true });
  expect('STAT 306 what-if on an unposted exam', totalPercent(whatIf.current, whatIf.unit), 86.06);
}

{
  expect('half-up rounding', roundHalfUp(89.995, 2), 90);
  expect('letter at a boundary', scoreToLetter(90, defaultGradingScheme), 'A-');
  expect('letter just under a boundary', scoreToLetter(89.99, defaultGradingScheme), 'B+');
  expect('letter for zero', scoreToLetter(0, defaultGradingScheme), 'F');
  expect('no letter without a score', scoreToLetter(null, defaultGradingScheme), null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  throw new Error('Grade calculator self-check failed');
}
console.log('\nAll grade calculator checks passed.');
