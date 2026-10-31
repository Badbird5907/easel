import type { AnswerValue, QuizQuestion } from '@/canvas/api/quizzes';
import { htmlToText } from '@/canvas/html';

/** Text-only items are part of the quiz but nothing to answer. */
export const isAnswerable = (q: QuizQuestion) => q.type !== 'text_only_question';

export type AnswerState = 'answered' | 'partial' | 'unanswered';

/** Answered, partly answered (some blanks or matches left), or not answered. */
export function answerState(q: QuizQuestion, a: AnswerValue): AnswerState {
  switch (a.kind) {
    case 'choice':
      return a.id ? 'answered' : 'unanswered';
    case 'choices':
      return a.ids.length ? 'answered' : 'unanswered';
    case 'matching': {
      const chosen = q.answers.filter((left) =>
        a.pairs.some((p) => p.answerId === left.id && p.matchId),
      ).length;
      return chosen === 0 ? 'unanswered' : chosen < q.answers.length ? 'partial' : 'answered';
    }
    case 'blanks': {
      const ids = q.blanks.length ? q.blanks.map((b) => b.id) : Object.keys(a.values);
      const filled = ids.filter((id) => (a.values[id] ?? '').trim() !== '').length;
      return filled === 0 ? 'unanswered' : filled < ids.length ? 'partial' : 'answered';
    }
    case 'text': {
      if (q.type === 'numerical_question' || q.type === 'calculated_question')
        return isNumberLike(a.value) ? 'answered' : 'unanswered';
      const text = q.type === 'essay_question' ? htmlToText(a.value) : a.value;
      return text.trim() ? 'answered' : 'unanswered';
    }
    case 'file':
      return a.attachmentId ? 'answered' : 'unanswered';
    case 'none':
      return 'unanswered';
  }
}

/** Typing saves after a pause; taps save right away. */
export function saveDelay(type: QuizQuestion['type']): number {
  switch (type) {
    case 'short_answer_question':
    case 'essay_question':
    case 'numerical_question':
    case 'calculated_question':
    case 'fill_in_multiple_blanks_question':
      return 800;
    default:
      return 0;
  }
}

/** Question numbers as students see them: text-only items aren't numbered. */
export function questionNumbers(questions: QuizQuestion[]): Map<string, number | null> {
  const numbers = new Map<string, number | null>();
  let n = 0;
  for (const q of questions) numbers.set(q.id, isAnswerable(q) ? ++n : null);
  return numbers;
}

/** Canvas's numerical answers accept digits, a sign, a decimal point or comma, and an exponent. */
export const isNumberLike = (value: string) =>
  /^\s*[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?\s*$/i.test(value);

/** Plain text of an answer choice, for labels. */
export const choiceText = (choice: { text: string; html: string | null }) =>
  choice.text || (choice.html ? htmlToText(choice.html) : '');

const pointsFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export function formatQuestionPoints(points: number | null): string | null {
  if (points === null) return null;
  return `${pointsFormat.format(points)} ${points === 1 ? 'pt' : 'pts'}`;
}
