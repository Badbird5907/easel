/** Removal is different from Cancel: cancelled work is useful; removed work must never be saved. */
type Lease = {
  accountId: string;
  courseId: string;
  removed: boolean;
  controller: AbortController;
  done: Promise<void>;
  finish: () => void;
};
const active = new Set<Lease>();
export function beginCourseSync(accountId: string, courseId: string, parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  const lease: Lease = {
    accountId,
    courseId,
    controller,
    removed: false,
    done,
    finish: () => {
      parent.removeEventListener('abort', abort);
      active.delete(lease);
      resolve();
    },
  };
  active.add(lease);
  return lease;
}
/** Synchronously revoke writes before awaiting any workers, then let callers remove durable state. */
export function revokeSync(accountId: string, courseId?: string): Promise<void> {
  const leases = [...active].filter(
    (l) => l.accountId === accountId && (courseId === undefined || l.courseId === courseId),
  );
  for (const lease of leases) {
    lease.removed = true;
    lease.controller.abort();
  }
  return Promise.all(leases.map((l) => l.done)).then(() => {});
}
