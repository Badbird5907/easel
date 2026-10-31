import type { CanvasClient } from '../client';
import { useCanvasMutation, useCanvasQuery } from '../query';

/** One link from `GET /api/v1/accounts/self/help_links` (app/models/account/help_links.rb). */
type CanvasHelpLink = {
  id?: string;
  text?: string;
  subtext?: string | null;
  url?: string;
  type?: 'default' | 'custom' | string;
  available_to?: string[];
  is_featured?: boolean;
  is_new?: boolean;
  feature_headline?: string | null;
};

/** `GET /api/v1/accounts/self/help_links` (accounts_controller#help_links). */
type CanvasHelpLinks = {
  help_link_name?: string;
  help_link_icon?: string;
  custom_help_links?: CanvasHelpLink[];
  default_help_links?: CanvasHelpLink[];
};

/**
 * What a help link does. Canvas marks its two built-in forms with fragment
 * URLs: `#teacher_feedback` asks an instructor, `#create_ticket` reports a
 * problem to the school's support.
 */
export type HelpAction =
  { kind: 'ask-instructor' } | { kind: 'report-problem' } | { kind: 'url'; url: string };

export type HelpLink = {
  id: string;
  title: string;
  subtitle: string | null;
  action: HelpAction;
  featured: boolean;
  isNew: boolean;
};

export type HelpLinks = {
  name: string;
  /** Only a locally generated fallback carries provenance; legacy cached names stay raw. */
  nameOrigin?: 'generated-help';
  links: HelpLink[];
};

function actionFor(link: CanvasHelpLink): HelpAction | null {
  const url = link.url?.trim() ?? '';
  if (link.id === 'instructor_question' || url === '#teacher_feedback') return { kind: 'ask-instructor' };
  if (link.id === 'report_a_problem' || url === '#create_ticket') return { kind: 'report-problem' };
  // Other built-ins (#ada_chatbot) only work inside Canvas web.
  if (!url || url.startsWith('#')) return null;
  return { kind: 'url', url };
}

/** Links meant for students: Canvas lists who each one is for. */
const forStudents = (link: CanvasHelpLink) =>
  !link.available_to || link.available_to.some((who) => who === 'student' || who === 'user');

export async function fetchHelpLinks(client: CanvasClient, signal?: AbortSignal): Promise<HelpLinks> {
  const data = await client.get<CanvasHelpLinks>('/api/v1/accounts/self/help_links', undefined, signal);
  // A school that customizes its menu replaces Canvas's defaults (as the official apps read it).
  const source = data.custom_help_links?.length ? data.custom_help_links : (data.default_help_links ?? []);
  const links = source.filter(forStudents).flatMap((link, index): HelpLink[] => {
    const action = actionFor(link);
    if (!action || !link.text) return [];
    return [
      {
        id: link.id ?? `link-${index}`,
        title: link.text,
        subtitle: link.subtext?.trim() || null,
        action,
        featured: !!link.is_featured,
        isNew: !!link.is_new,
      },
    ];
  });
  return {
    name: data.help_link_name || 'Help',
    ...(!data.help_link_name ? { nameOrigin: 'generated-help' as const } : {}),
    links: [...links.filter((l) => l.featured), ...links.filter((l) => !l.featured)],
  };
}

export function useHelpLinks() {
  return useCanvasQuery(['help', 'links'], fetchHelpLinks, { staleTime: 60 * 60_000 });
}

/** `user_perceived_severity` values, from least to most urgent (errors_controller.rb). */
export type Severity =
  | 'just_a_comment'
  | 'not_urgent'
  | 'workaround_possible'
  | 'blocks_what_i_need_to_do'
  | 'extreme_critical_emergency';

export type ProblemReport = {
  subject: string;
  description: string;
  severity: Severity;
  email: string;
  /** Who and where, so support can find the student: host, user ID, app version, device. */
  context: Record<string, string>;
};

/** `POST /api/v1/error_reports` (errors_controller#create). */
export async function sendProblemReport(client: CanvasClient, report: ProblemReport): Promise<void> {
  const details = Object.entries(report.context)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  await client.post('/api/v1/error_reports', {
    error: {
      subject: report.subject,
      comments: `${report.description}\n\n-----------------------------------\n${details}`,
      email: report.email || undefined,
      user_perceived_severity: report.severity,
      url: client.baseUrl,
      http_env: report.context,
    },
  });
}

export function useSendProblemReport() {
  return useCanvasMutation((client, report: ProblemReport) => sendProblemReport(client, report));
}
