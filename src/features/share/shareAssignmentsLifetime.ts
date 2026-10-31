/** Committed picker controls. Entry guards cannot undo preparation/native work. */
export class ShareAssignmentsOwner {
  private state = { epoch: null as object | null, refreshing: false, selected: false };
  private listeners = new Set<() => void>();
  constructor(
    private focused: boolean,
    private navigation: { isFocused(): boolean },
    private sourceCurrent: () => boolean = () => true,
  ) {}
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
  activate() {
    this.update({ epoch: {}, refreshing: false, selected: false });
  }
  retire() {
    this.update({ epoch: null, refreshing: false });
  }
  private current(epoch: object | null) {
    return (
      !!epoch &&
      epoch === this.state.epoch &&
      this.focused &&
      this.navigation.isFocused() &&
      this.sourceCurrent()
    );
  }
  choose(epoch: object | null, prepare: () => void) {
    if (!this.current(epoch) || this.state.selected) return;
    this.update({ selected: true });
    if (this.current(epoch)) prepare();
  }
  async refresh(epoch: object | null, fetch: () => Promise<unknown>) {
    if (!this.current(epoch) || this.state.refreshing || this.state.selected) return;
    this.update({ refreshing: true });
    try {
      await fetch();
    } catch {
      // The query owns its error UI. Rejections must release this refresh claim.
    } finally {
      if (this.current(epoch)) this.update({ refreshing: false });
    }
  }
}
