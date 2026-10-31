import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSession } from '@/canvas/session';
import type { Course } from '@/canvas/models';
import { canvasBridge, type BridgeChange } from './canvasBridge';
import { getSettings, settingsStore } from './settings';

/** Mirror only non-secret identifiers and course names. Never credentials or notification text. */
export function useCanvasBridge() {
  const client = useQueryClient();
  const { accounts, active } = useSession();
  useEffect(() => {
    const bridge = canvasBridge;
    if (!bridge) return;
    const sync = () => bridge.sync(JSON.stringify({
      ...getSettings(), activeId: active?.id,
      accounts: accounts.filter(a => !a.expired && a.authMethod !== 'demo').map(a => ({
        id: a.id, host: a.host,
        courses: (client.getQueryData<Course[]>([a.id, 'courses', 'dashboard']) ?? []).map(c => ({
          id: c.id, names: [...new Set([c.name, c.originalName, c.code].filter(Boolean))],
        })),
      })),
    }));
    const refresh = () => {
      sync();
      const changes = JSON.parse(bridge.drainChanges()) as BridgeChange[];
      for (const change of changes) {
        // Invalidate retained data; active observers use the existing cache-first refresh path.
        void client.invalidateQueries({ predicate: query => {
          if (query.queryKey[0] !== change.accountId) return false;
          const kind = query.queryKey[1];
          return kind === 'activity' || kind === 'planner' ||
            (change.category === 'messages' ? kind === 'conversations' || kind === 'conversation' :
              kind === change.category || (kind === 'courses' && (!change.courseId || query.queryKey[2] === change.courseId)));
        }});
      }
    };
    refresh();
    const settings = settingsStore.subscribe(sync);
    const cache = client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[1] === 'courses') sync();
    });
    const focus = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { settings(); cache(); focus.remove(); };
  }, [accounts, active?.id, client]);
}
