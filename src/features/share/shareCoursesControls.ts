/** Local course-picker controls; render constructs them, commit admits actions. */
export class ShareCoursesControls {
  private active = false;
  private selected = false;
  private query: object | null = null;
  private state: { refreshing: boolean; failure: { error: unknown } | null } = {
    refreshing: false,
    failure: null,
  };
  private listeners = new Set<() => void>();

  constructor(private isFocused: () => boolean) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(state: typeof this.state) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
  }
  retire() {
    this.active = false;
    this.selected = false;
    // A fresh snapshot prevents effect replay from reviving retained callbacks.
    this.publish({ refreshing: false, failure: null });
  }
  commitQuery(query: object) {
    this.query = query;
  }
  private accepts(state: typeof this.state, query: object) {
    return this.active && this.isFocused() && !this.selected && this.state === state && this.query === query;
  }
  select(state: typeof this.state, query: object, navigate: () => void) {
    if (!this.accepts(state, query) || state.refreshing || state.failure) return;
    this.selected = true;
    navigate();
  }
  async refresh(state: typeof this.state, query: object, run: () => Promise<unknown>) {
    if (!this.accepts(state, query) || state.refreshing) return;
    const pending = { refreshing: true, failure: state.failure };
    this.publish(pending);
    let failure: { error: unknown } | null = null;
    try {
      await run();
    } catch (error) {
      failure = { error };
    }
    // Query updates during the request are expected. Source retirement/replay
    // replaces the snapshot and prevents an old request from settling new UI.
    if (this.active && this.isFocused() && this.state === pending)
      this.publish({ refreshing: false, failure });
  }
}
