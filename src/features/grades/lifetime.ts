import { useLayoutEffect, useMemo, useState } from 'react';

/** A render cannot retire a committed screen. Claims change only at commit or event entry. */
class GradeLifetime {
  active = false;
  readonly pending = new Set<string>();
  constructor(
    readonly key: string,
    readonly client: object,
    readonly parent?: GradeLifetime,
  ) {}
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.pending.clear();
  }
  valid(): boolean {
    return this.active && (!this.parent || this.parent.valid());
  }
  claim(key: string) {
    if (!this.valid() || this.pending.has(key)) return false;
    this.pending.add(key);
    return true;
  }
}
export function useGradeLifetime(key: string, client: object, parent?: GradeLifetime) {
  const owner = useMemo(() => new GradeLifetime(key, client, parent), [key, client, parent]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  return owner;
}

/** Render-adjusted state: a replacement scope never renders the retired scope's values. */
export function useGradeState<T>(owner: object, initial: () => T) {
  const [state, setState] = useState(() => ({ owner, value: initial() }));
  let current = state;
  if (state.owner !== owner) {
    current = { owner, value: initial() };
    setState(current);
  }
  const set = (value: T | ((previous: T) => T)) =>
    setState((previous) =>
      previous.owner === owner
        ? {
            owner,
            value: typeof value === 'function' ? (value as (p: T) => T)(previous.value) : value,
          }
        : previous,
    );
  return [current.value, set] as const;
}

/** Refetch functions can reject (or throw synchronously). Settle every entered query. */
export async function settleGradesRefresh(
  jobs: (() => unknown)[],
  canEnter: () => boolean = () => true,
) {
  return Promise.allSettled(
    jobs.map((job) => Promise.resolve().then(() => (canEnter() ? job() : undefined))),
  );
}
export function useGradesRefresh(owner: GradeLifetime, jobs: (() => unknown)[]) {
  const [refreshing, setRefreshing] = useGradeState(owner, () => false);
  const refresh = async () => {
    if (!owner.claim('refresh')) return;
    setRefreshing(true);
    try {
      await settleGradesRefresh(jobs, () => owner.valid());
    } finally {
      owner.pending.delete('refresh');
      if (owner.valid()) setRefreshing(false);
    }
  };
  return { refreshing, refresh };
}
