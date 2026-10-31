import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { useAccountKey } from '../query';

/** Observer-only data: incomplete list records never become authoritative detail cache entries. */
export function useListPlaceholder<List, Item>(prefix: QueryKey, select: (list: List) => Item | undefined) {
  const client = useQueryClient();
  const account = useAccountKey();
  return () => {
    const queries = client.getQueryCache().findAll({ queryKey: [account, ...prefix] });
    queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    for (const query of queries) {
      if (query.state.data === undefined) continue;
      const item = select(query.state.data as List);
      if (item !== undefined) return item;
    }
    return undefined;
  };
}
