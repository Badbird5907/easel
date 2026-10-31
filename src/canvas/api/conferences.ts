import type { CanvasClient } from '../client';
import { htmlToText } from '../html';
import { useCanvasQuery } from '../query';

/*
 * Web conferences: BigBlueButton, Zoom, and other conference tools a course
 * or group sets up. Two workstreams share this file:
 * - Home's live banner (HOME-8): `LiveConference`, `fetchLiveConferences`, `useLiveConferences`.
 * - A course's or group's conference list with recordings (CONTENT-11): `Conference` and below.
 * Joining happens in the browser, signed in through `session_token`, because
 * Canvas starts the meeting on the web.
 */

/** conference_json (lib/api/v1/conferences.rb) */
type CanvasConference = {
  id: string;
  title: string;
  conference_type?: string;
  description?: string | null;
  /** Minutes; null for long-running conferences. */
  duration?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  long_running?: boolean;
  context_type: 'Course' | 'Group' | string;
  context_id: string;
  /** The conference page on the web. */
  url?: string;
  /** Where "Join" goes on the web: `/courses/:id/conferences/:id/join`. */
  join_url?: string | null;
  recordings?: CanvasRecording[];
  users?: string[];
};

/** A recording (WebConference#recordings, as conference_json sends it). */
type CanvasRecording = {
  recording_id: string;
  title?: string | null;
  duration_minutes?: number | null;
  /** The main playback page. */
  playback_url?: string | null;
  playback_formats?: {
    type: string;
    url: string;
    length?: string | null;
    translated_type?: string | null;
    /** BigBlueButton hides some formats, like statistics, from students. */
    show_to_students?: boolean;
  }[];
  created_at?: string | number | null;
  ended_at?: string | number | null;
};

// MARK: Home's live banner (HOME-8)

export type LiveConference = {
  id: string;
  title: string;
  startedAt: Date | null;
  contextType: 'course' | 'group';
  contextId: string;
  /** Canvas's join page, which signs the student into the conference provider. */
  joinPath: string;
};

/**
 * Conferences running right now in the student's courses and groups (HOME-8),
 * from `GET /api/v1/conferences?state=live` (conferences_controller#for_user).
 */
export async function fetchLiveConferences(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<LiveConference[]> {
  const { conferences } = await client.get<{ conferences: CanvasConference[] }>(
    '/api/v1/conferences',
    { state: 'live' },
    signal,
  );
  return (conferences ?? [])
    .filter((c) => c.started_at && !c.ended_at)
    .flatMap((c): LiveConference[] => {
      const contextType =
        c.context_type === 'Group' ? 'group' : c.context_type === 'Course' ? 'course' : null;
      if (!contextType) return [];
      return [
        {
          id: String(c.id),
          title: c.title,
          startedAt: c.started_at ? new Date(c.started_at) : null,
          contextType,
          contextId: String(c.context_id),
          // The same join route the official apps open (ConferenceDetailsViewController.swift).
          joinPath: `/${contextType}s/${c.context_id}/conferences/${c.id}/join`,
        },
      ];
    });
}

export function useLiveConferences() {
  // A live banner that's minutes stale is wrong, so this refreshes more often than most.
  return useCanvasQuery(['conferences', 'live'], fetchLiveConferences, {
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

// MARK: Conference list (CONTENT-11)

export type ConferenceStatus = 'live' | 'scheduled' | 'ended';

export type RecordingFormat = 'presentation' | 'video' | 'statistics' | 'notes' | 'screenshare' | 'podcast';

export type Recording = {
  /** Present only when Canvas omitted its title. */
  fallbackTitleNumber?: number;
  id: string;
  title: string;
  durationMinutes: number | null;
  createdAt: Date | null;
  /** Where to watch it: the playback page, or the first format's link. */
  url: string | null;
  /** Other ways to play it, e.g. "Presentation" or "Video". */
  formats: { label: string; url: string; fallbackType?: RecordingFormat }[];
};

export type Conference = {
  /** Present only when Canvas omitted its title. */
  fallbackTitle?: true;
  id: string;
  title: string;
  /** "BigBlueButton", "Zoom", or the plugin's name. */
  provider: string | null;
  description: string;
  status: ConferenceStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMinutes: number | null;
  longRunning: boolean;
  /** The web page with the conference's details. */
  url: string | null;
  /** Canvas's join page, as Home's banner uses. */
  joinPath: string;
  recordings: Recording[];
};

const providers: Record<string, string> = {
  BigBlueButton: 'BigBlueButton',
  BigBlueButtonConference: 'BigBlueButton',
  Zoom: 'Zoom',
  AdobeConnect: 'Adobe Connect',
  Wimba: 'Wimba',
};

const formatLabels: Record<string, string> = {
  presentation: 'Presentation',
  video: 'Video',
  statistics: 'Statistics',
  notes: 'Notes',
  screenshare: 'Screen share',
  podcast: 'Audio',
};

function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  // BigBlueButton sends recording times as milliseconds since the epoch.
  const date = typeof value === 'number' || /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRecording(r: CanvasRecording, index: number): Recording {
  const formats = (r.playback_formats ?? [])
    .filter((f) => !!f.url && f.show_to_students !== false)
    .map((f) => {
      const known = Object.prototype.hasOwnProperty.call(formatLabels, f.type);
      return {
        label: f.translated_type || (known ? formatLabels[f.type] : f.type),
        url: f.url,
        ...(!f.translated_type && known ? { fallbackType: f.type as RecordingFormat } : {}),
      };
    });
  return {
    id: String(r.recording_id),
    title: r.title?.trim() || `Recording ${index + 1}`,
    ...(!r.title?.trim() ? { fallbackTitleNumber: index + 1 } : {}),
    durationMinutes: r.duration_minutes ?? null,
    createdAt: toDate(r.created_at),
    url: r.playback_url || formats[0]?.url || null,
    formats,
  };
}

function toConference(c: CanvasConference, context: { type: 'course' | 'group'; id: string }): Conference {
  return {
    id: String(c.id),
    title: c.title?.trim() || 'Untitled conference',
    ...(!c.title?.trim() ? { fallbackTitle: true as const } : {}),
    provider: c.conference_type
      ? (Object.hasOwn(providers, c.conference_type) ? providers[c.conference_type] : c.conference_type)
      : null,
    description: htmlToText(c.description ?? '').trim(),
    status: c.ended_at ? 'ended' : c.started_at ? 'live' : 'scheduled',
    startedAt: toDate(c.started_at),
    endedAt: toDate(c.ended_at),
    durationMinutes: c.long_running ? null : (c.duration ?? null),
    longRunning: !!c.long_running,
    url: c.url ?? null,
    joinPath: c.join_url || `/${context.type}s/${context.id}/conferences/${c.id}/join`,
    recordings: (c.recordings ?? []).map(toRecording),
  };
}

export class ConferencesUnavailableError extends Error {
  readonly reason = 'notSetup';
  constructor(readonly serverError: SyntaxError) {
    super('Your school hasn’t set up conferences in Canvas. Ask your instructor how to join.');
  }
}

const order: Record<ConferenceStatus, number> = { live: 0, scheduled: 1, ended: 2 };
const recency = (c: Conference) => (c.endedAt ?? c.startedAt)?.getTime() ?? 0;

/** Live first, then scheduled, then past ones, most recent first. */
export function sortConferences(list: Conference[]): Conference[] {
  return [...list].sort((a, b) => order[a.status] - order[b.status] || recency(b) - recency(a));
}

/** `GET /api/v1/courses/:id/conferences` or the group's. Canvas wraps the list in `conferences`. */
export async function fetchConferences(
  client: CanvasClient,
  context: { type: 'course' | 'group'; id: string },
  signal?: AbortSignal,
): Promise<Conference[]> {
  let data: { conferences?: CanvasConference[] } | undefined;
  try {
    // The list arrives wrapped in an object, so it's read as one page; 100 covers any course.
    data = await client.get<{ conferences?: CanvasConference[] }>(
      `/api/v1/${context.type === 'course' ? 'courses' : 'groups'}/${context.id}/conferences`,
      { per_page: 100 },
      signal,
    );
  } catch (error) {
    // Without a conference tool set up, Canvas redirects to a web page instead of answering.
    if (error instanceof SyntaxError)
      throw new ConferencesUnavailableError(error);
    throw error;
  }
  return sortConferences((data?.conferences ?? []).map((c) => toConference(c, context)));
}

export function useConferences(context: { type: 'course' | 'group'; id: string }) {
  return useCanvasQuery(['conferences', context.type, context.id], (client, signal) =>
    fetchConferences(client, context, signal),
  );
}
