import { CanvasError, CanvasNetworkError } from '@/canvas/client';
import type { CanvasClient } from '@/canvas/client';
import { uploadToCanvas } from '@/canvas/uploads';

import type { SharedFile } from './content';

export type ShareFoldersError = 'network' | 'quota' | 'permission' | 'upload' | 'interrupted';
export type ShareFoldersRow = {
  file: SharedFile;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  fraction: number | null;
  error: ShareFoldersError | null;
};

/** Local ownership, not remote cancellation: entered native stages may still finish. */
export class ShareFoldersOwner {
  private state = {
    epoch: null as object | null,
    uploads: null as ShareFoldersRow[] | null,
    busy: false,
    refreshing: false,
    refreshFailed: false,
  };
  private listeners = new Set<() => void>();
  private currentControl = () => false;
  private allowed = false;
  private selected = false;
  constructor(
    private client: CanvasClient,
    private folderId: string | undefined,
    private files: SharedFile[],
    private sourceCurrent: () => boolean,
    private invalidate: () => Promise<unknown>,
  ) {
    // Capture invocation values independently of the mutable store objects.
    this.files = files.map((file) => ({ ...file }));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate(current: () => boolean, allowed: boolean) {
    this.currentControl = current;
    this.allowed = allowed;
    this.selected = false;
    this.update({ epoch: {}, refreshing: false });
  }
  retire() {
    this.update({ epoch: null, refreshing: false });
  }
  private current(epoch: object | null) {
    return !!epoch && epoch === this.state.epoch && this.sourceCurrent() && this.currentControl();
  }
  private patch(index: number, change: Partial<ShareFoldersRow>) {
    this.update({
      uploads: this.state.uploads?.map((row, i) => (i === index ? { ...row, ...change } : row)) ?? null,
    });
  }
  action(epoch: object | null, action: () => void, completion = false) {
    if (!this.current(epoch) || this.state.busy || this.state.refreshing || this.selected) return;
    if (completion && !this.complete()) return;
    this.selected = true;
    if (this.current(epoch)) action();
  }
  private complete() {
    return !!this.state.uploads?.length && this.state.uploads.every((row) => row.status === 'done');
  }
  async refresh(epoch: object | null, fetch: () => Promise<unknown>) {
    if (!this.current(epoch) || this.state.busy || this.state.refreshing || this.selected) return;
    this.update({ refreshing: true, refreshFailed: false });
    try {
      if (this.current(epoch)) await fetch();
    } catch {
      if (this.current(epoch)) this.update({ refreshFailed: true });
    } finally {
      if (this.current(epoch)) this.update({ refreshing: false });
    }
  }
  async run(epoch: object | null, feedback: (ok: boolean, owns: () => boolean) => void, retry?: number) {
    if (
      !this.current(epoch) ||
      !this.allowed ||
      !this.folderId ||
      !this.files.length ||
      this.state.busy ||
      this.state.refreshing ||
      this.selected
    )
      return;
    if (retry === undefined ? this.state.uploads !== null : this.state.uploads?.[retry]?.status !== 'error')
      return;
    const indexes = retry === undefined ? this.files.map((_, i) => i) : [retry];
    this.update({
      busy: true,
      refreshFailed: false,
      uploads:
        this.state.uploads ??
        this.files.map((file) => ({ file, status: 'waiting', fraction: null, error: null })),
    });
    const owns = () => this.current(epoch);
    let entered = false;
    try {
      for (const index of indexes) {
        if (!owns()) break;
        this.patch(index, { status: 'uploading', fraction: 0, error: null });
        if (!owns()) break;
        let last = 0;
        let settled = false;
        try {
          entered = true;
          await uploadToCanvas(this.client, '/api/v1/users/self/files', this.files[index], {
            params: { parent_folder_id: this.folderId, on_duplicate: 'rename' },
            onProgress: (fraction) => {
              if (settled || !owns()) return;
              if (fraction !== null && fraction < 1 && fraction - last < 0.02) return;
              last = fraction ?? 0;
              this.patch(index, { fraction });
            },
          });
          // Retain accepted results on this owner even after blur/permission retirement.
          // Replacement sources have their own owner and never see these rows.
          this.patch(index, { status: 'done', fraction: 1, error: null });
        } catch (error) {
          this.patch(index, {
            status: 'error',
            error:
              error instanceof CanvasNetworkError
                ? 'network'
                : error instanceof CanvasError && /quota/i.test(error.message)
                  ? 'quota'
                  : error instanceof CanvasError && [401, 403].includes(error.status)
                    ? 'permission'
                    : 'upload',
          });
        } finally {
          settled = true;
        }
      }
      // Invalidate the captured account even if ownership was lost. A refresh failure
      // must never turn an accepted file into a retryable upload error.
      if (entered) {
        try {
          await this.invalidate();
        } catch {
          if (owns()) this.update({ refreshFailed: true });
        }
      }
      if (entered && owns()) feedback(this.complete(), owns);
    } finally {
      this.update({
        busy: false,
        uploads:
          this.state.uploads?.map((row) =>
            row.status === 'waiting' || row.status === 'uploading'
              ? { ...row, status: 'error', error: 'interrupted', fraction: null }
              : row,
          ) ?? null,
      });
    }
  }
}
