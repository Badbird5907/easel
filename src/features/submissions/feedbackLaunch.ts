import { randomUUID } from 'expo-crypto';

/** Feedback capabilities are deliberately separate from tool-editor tokens. */
export type FeedbackOwner = {
  accountId: string;
  client: object;
  courseId: string;
  assignmentId: string;
};
export type FeedbackDocument = {
  attempt: number;
  fileId: string;
  url: string;
  title: string | undefined;
  canvasUrl: string | undefined;
};
type Launch = {
  source: object;
  owner: FeedbackOwner;
  document: Readonly<FeedbackDocument>;
  expires: number;
  viewer?: object;
};
const launches = new Map<string, Launch>();
const listeners = new Set<() => void>();
const expiredViewers = new WeakSet<object>();
let revision = 0;
export const feedbackRevision = () => revision;
export function subscribeFeedback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  revision++;
  for (const listener of listeners) listener();
}
export function revokeFeedback(token: string, viewer?: object) {
  const entry = launches.get(token);
  if (!entry || (viewer && entry.viewer !== viewer)) return;
  launches.delete(token);
  changed();
}
export function revokeFeedbackSource(source: object) {
  for (const [token, entry] of launches) if (entry.source === source) revokeFeedback(token);
}
/** A committed identity replacement permanently expires this mounted viewer. */
export function expireFeedbackViewer(viewer: object) {
  expiredViewers.add(viewer);
  for (const [token, entry] of launches) if (entry.viewer === viewer) revokeFeedback(token, viewer);
}
/** Event-only publication. The caller must still own its committed source context.
 * A push may unmount that source, so source cleanup alone does not revoke a launch.
 * Pending launches expire after five minutes; the next publication prunes them. At most
 * 64 documents can be retained, including active viewers, which are never evicted.
 */
export function beginFeedbackLaunch(
  source: object,
  current: () => boolean,
  owner: FeedbackOwner,
  document: FeedbackDocument,
): string | null {
  if (!current()) return null;
  for (const [token, entry] of launches)
    if (!entry.viewer && entry.expires <= Date.now()) revokeFeedback(token);
  if (launches.size >= 64) return null;
  const token = randomUUID();
  launches.set(token, {
    source,
    owner: { ...owner },
    document: Object.freeze({ ...document }),
    expires: Date.now() + 5 * 60_000,
  });
  changed();
  return token;
}
function lookup(token: unknown, owner: FeedbackOwner) {
  if (typeof token !== 'string') return null;
  const entry = launches.get(token);
  if (!entry || (!entry.viewer && entry.expires <= Date.now())) return null;
  if (
    (Object.keys(entry.owner) as (keyof FeedbackOwner)[]).some((k) => entry.owner[k] !== owner[k])
  )
    return null;
  return entry;
}
/** Read-only render check: authenticate the original owner before exposing any
 * payload, but do not acquire a pending launch. Competing commits claim below;
 * an already claimed launch is visible exclusively to that viewer.
 */
export function feedbackDocument(token: unknown, owner: FeedbackOwner, viewer: object) {
  if (expiredViewers.has(viewer)) return null;
  const entry = lookup(token, owner);
  return entry && (!entry.viewer || entry.viewer === viewer) ? entry.document : null;
}
/** Layout-effect acquisition, exclusive even across duplicate mounted routes. */
export function claimFeedback(token: unknown, owner: FeedbackOwner, viewer: object) {
  if (expiredViewers.has(viewer)) return false;
  const entry = lookup(token, owner);
  if (!entry || (entry.viewer && entry.viewer !== viewer)) return false;
  if (!entry.viewer) {
    entry.viewer = viewer;
    changed();
  }
  return true;
}
