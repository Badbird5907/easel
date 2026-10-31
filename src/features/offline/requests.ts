import { type CanvasClient, CanvasNetworkError } from '@/canvas/client';

import type { QueueLabelDescriptor } from './presentation';
import { isOnline } from './connectivity';
import { enqueueWrite, pendingWrites, registerWriteHandler } from './queue';

/*
 * Plain Canvas requests that can wait for the network (OFF-2). For writes
 * whose request is all there is to them, with no cache to patch: a what-if
 * score, a draft that becomes a comment or a reply. Pending requests with the
 * same key collapse, so the newest one wins.
 */

export type QueueableRequest = {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** Requests with the same key replace each other while they wait. */
  key: string;
  /** What the student did, for "Will sync" lists and notices. */
  label: string;
  labelDescriptor?: QueueLabelDescriptor;
  /** Query key without the account prefix, refreshed after replay. */
  invalidate?: readonly unknown[];
};

type Payload = Pick<QueueableRequest, 'method' | 'path' | 'body' | 'invalidate'>;

registerWriteHandler<Payload>('request', {
  run: (p, { client }) => client.request(p.path, { method: p.method, body: p.body }),
  onSuccess: (_result, p, { accountId, queryClient }) => {
    if (p.invalidate) void queryClient?.invalidateQueries({ queryKey: [accountId, ...p.invalidate] });
  },
});

/**
 * Sends a request now, or queues it when Easel is offline or Canvas can't be
 * reached. Errors other than the connection still throw.
 */
export async function sendOrQueue<T>(
  accountId: string,
  client: CanvasClient,
  request: QueueableRequest,
): Promise<{ sent: true; data: T } | { sent: false }> {
  const queue = () => {
    enqueueWrite<Payload>({
      accountId,
      kind: 'request',
      key: request.key,
      label: request.label,
      labelDescriptor: request.labelDescriptor,
      payload: { method: request.method, path: request.path, body: request.body, invalidate: request.invalidate },
    });
    return { sent: false } as const;
  };
  // Something with the same key is already waiting: go behind it, so the newest wins.
  if (!isOnline() || pendingWrites(accountId).some((w) => w.kind === 'request')) return queue();
  try {
    const data = await client.request<T>(request.path, { method: request.method, body: request.body });
    return { sent: true, data };
  } catch (error) {
    if (error instanceof CanvasNetworkError) return queue();
    throw error;
  }
}
