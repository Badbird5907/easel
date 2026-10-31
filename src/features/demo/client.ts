import { CanvasClient, CanvasError, type Query, type RequestOptions } from '../../canvas/client';
import fixture from './data.json';
import { demoImage } from './assets';

export const DEMO_URL = 'https://demo.easel.invalid';
export const DEMO_ID = 'easel_demo';

/** Shift calendar days, preserving local wall time across daylight-saving transitions. */
export function reanchor(value: unknown, now = new Date()): unknown {
  const anchor = new Date(fixture.anchor);
  const days = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) /
      86400000,
  );
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) {
      const [year, month, day] = v.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) {
      const d = new Date(v);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    }
    return typeof v === 'string' ? v.replaceAll('DEMO_CELL_IMAGE', demoImage) : v;
  };
  return walk(value);
}

/** No transport: every method dispatches into this account's private session state. */
export class DemoClient extends CanvasClient {
  private data: Record<string, unknown>;
  private nextId = 800000;
  constructor(
    now = new Date(),
    private readonly unavailable = () => 'Not available in demo mode.',
  ) {
    super(DEMO_URL, '');
    const bodies = reanchor(fixture.bodies, now) as unknown[];
    this.data = Object.fromEntries(
      Object.entries(fixture.responses).map(([path, index]) => [path, bodies[index]]),
    );
  }
  override get authHeaders() {
    return {};
  }
  override async freshAuthHeaders() {
    return {};
  }
  override async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, DEMO_URL);
    const payload = (options.body ?? {}) as Record<string, any>;
    if (url.origin === DEMO_URL && url.pathname === '/api/graphql') {
      const vars = payload.variables ?? {};
      if (payload.operationName === 'EaselDiscussionPermissions')
        return {
          data: { legacyNode: { canReplyAnonymously: false, discussionEntriesConnection: { nodes: [] } } },
        } as T;
      if (payload.operationName === 'EaselCreateDiscussionEntry') {
        const id = String(this.nextId++);
        const view = Object.entries(this.data).find(([key]) =>
          key.endsWith(`/discussion_topics/${vars.topicId}/view`),
        )?.[1] as any;
        if (!view) throw new CanvasError(this.unavailable(), 404, path);
        const entry = {
          id,
          user_id: '1001',
          message: vars.message,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          replies: [],
        };
        const parent = vars.parentId
          ? (view.view ?? []).find((e: any) => String(e.id) === String(vars.parentId))
          : null;
        (parent ? parent.replies : view.view).push(entry);
        return { data: { createDiscussionEntry: { discussionEntry: { _id: id }, errors: [] } } } as T;
      }
      throw new CanvasError(this.unavailable(), 403, path);
    }
    if (
      url.origin !== DEMO_URL ||
      /login|oauth|uploads|external_tools|session|graphql|canvadoc/.test(url.pathname)
    ) {
      throw new CanvasError(this.unavailable(), 403, path);
    }
    const key = url.pathname;
    const method = options.method ?? 'GET';
    if (method === 'GET') {
      let value = this.data[key];
      if (Array.isArray(value) && key === '/api/v1/calendar_events' && options.query?.type)
        value = value.filter((item) => item.type === options.query?.type);
      if (Array.isArray(value) && key === '/api/v1/conversations') {
        if (options.query?.scope === 'unread')
          value = value.filter((item) => item.workflow_state === 'unread');
        else if (options.query?.scope === 'starred') value = value.filter((item) => item.starred);
      }
      if (value === undefined) throw new CanvasError(this.unavailable(), 404, path);
      return JSON.parse(JSON.stringify(value)) as T;
    }
    const body = (options.body ?? {}) as Record<string, any>;
    const id = String(this.nextId++);
    let value: any = this.data[key];
    if (/\/quizzes\/[^/]+\/submissions/.test(key)) {
      const base = key.replace(/\/submissions.*/, '/submissions');
      const prior = this.data[base] as any;
      if (key.endsWith('/complete')) {
        value = prior;
        value.quiz_submissions[0].workflow_state = 'complete';
        value.quiz_submissions[0].finished_at = new Date().toISOString();
        value.quiz_submissions[0].score = 4;
      } else {
        const submission = {
          id,
          quiz_id: base.split('/').at(-2),
          user_id: '1001',
          attempt: 1,
          started_at: new Date().toISOString(),
          end_at: null,
          finished_at: null,
          workflow_state: 'untaken',
          validation_token: 'demo',
          time_spent: 0,
          score: null,
          kept_score: null,
          extra_attempts: 0,
          attempts_left: 2,
        };
        value = { quiz_submissions: [submission] };
        this.data[base] = value;
        this.data[`${base}/${id}`] = value;
        this.data[`${base}/${id}/time`] = { time_left: 1800 };
        this.data[`/api/v1/quiz_submissions/${id}/questions`] = {
          quiz_submission_questions: [
            {
              id: '1',
              quiz_id: submission.quiz_id,
              question_type: 'multiple_choice_question',
              question_name: 'Cell biology',
              question_text: '<p>Which structure contains genetic material?</p>',
              points_possible: 1,
              position: 1,
              answers: [
                { id: '11', text: 'Nucleus' },
                { id: '12', text: 'Cell wall' },
              ],
            },
          ],
        };
      }
    } else if (/\/quiz_submissions\//.test(key) || key.endsWith('/events')) {
      value = this.data[key] ?? {};
      if (body.quiz_questions)
        for (const answer of body.quiz_questions) {
          const question = (value.quiz_submission_questions ?? []).find((q: any) => q.id === answer.id);
          if (question) question.answer = answer.answer;
        }
    } else if (key.includes('/planner/overrides')) {
      value = { id: key.split('/').pop() === 'overrides' ? id : key.split('/').pop(), ...body };
      const items = this.data['/api/v1/planner/items'] as any[];
      for (const item of items ?? [])
        if (String(item.plannable_id) === String(body.plannable_id) || item.planner_override?.id === value.id)
          item.planner_override = value;
    } else if (key.includes('/planner_notes')) {
      value = { id, created_at: new Date().toISOString(), user_id: '1001', ...(value ?? {}), ...body };
      this.data[`/api/v1/planner_notes/${value.id}`] = value;
      const items = this.data['/api/v1/planner/items'] as any[];
      if (method === 'POST')
        items?.push({
          plannable_id: value.id,
          plannable_type: 'planner_note',
          plannable: value,
          plannable_date: value.todo_date,
          context_type: 'User',
          submissions: false,
        });
      else for (const item of items ?? []) if (item.plannable_id === value.id) item.plannable = value;
    } else if (/\/submissions$/.test(key)) {
      value = {
        id,
        user_id: '1001',
        assignment_id: key.split('/').at(-2),
        attempt: 1,
        submitted_at: new Date().toISOString(),
        workflow_state: 'submitted',
        ...body.submission,
      };
      this.data[`${key}/self`] = value;
      const assignment = this.data[key.replace(/\/submissions$/, '')] as any;
      if (assignment) assignment.submission = value;
    } else if (/\/entries$|\/replies$/.test(key)) {
      value = {
        id,
        user_id: '1001',
        user_name: 'Demo Student',
        created_at: new Date().toISOString(),
        message: body.message,
        replies: [],
      };
      const list = this.data[key];
      if (Array.isArray(list)) list.push(value);
    } else if (key.includes('/conversations')) {
      const message = { id, author_id: '1001', created_at: new Date().toISOString(), body: body.body };
      if (key.endsWith('/add_message')) {
        value = this.data[key.replace('/add_message', '')] as any;
        value?.messages?.unshift(message);
      } else if (method === 'POST') {
        value = {
          id,
          subject: body.subject,
          workflow_state: 'read',
          participants: [],
          messages: [message],
          last_message: body.body,
          last_message_at: message.created_at,
        };
        (this.data[key] as any[])?.unshift(value);
        this.data[`${key}/${id}`] = value;
      } else value = { ...value, ...body };
    } else if (/\/done$|\/mark_read$/.test(key)) {
      value = { completion_requirement: { type: 'must_mark_done', completed: method !== 'DELETE' } };
      const itemId = key.split('/').at(-2);
      const update = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (String(node.id) === itemId && node.completion_requirement)
          node.completion_requirement.completed = method !== 'DELETE';
        for (const child of Object.values(node)) update(child);
      };
      update(this.data);
    } else {
      throw new CanvasError(this.unavailable(), 403, path);
    }
    if (method === 'DELETE') delete this.data[key];
    else if (!Array.isArray(this.data[key])) this.data[key] = value;
    return JSON.parse(
      JSON.stringify(key === '/api/v1/conversations' && method === 'POST' ? [value] : value),
    ) as T;
  }
  override async getPage<T>(path: string, query?: Query): Promise<{ items: T[]; next: string | null }> {
    const all = await this.get<T[]>(path, query);
    const url = new URL(path, DEMO_URL);
    const per = Number(query?.per_page ?? url.searchParams.get('per_page') ?? 100);
    const page = Number(query?.page ?? url.searchParams.get('page') ?? 1);
    return {
      items: all.slice((page - 1) * per, page * per),
      next: page * per < all.length ? `${url.origin}${url.pathname}?page=${page + 1}&per_page=${per}` : null,
    };
  }
  override async getAll<T>(
    path: string,
    query?: Query,
    options: { signal?: AbortSignal; maxPages?: number } = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = path;
    let pages = 0;
    while (next && pages++ < (options.maxPages ?? 50)) {
      const result: { items: T[]; next: string | null } = await this.getPage<T>(
        next,
        pages === 1 ? query : undefined,
      );
      items.push(...result.items);
      next = result.next;
    }
    return items;
  }
}
