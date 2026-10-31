import { router } from 'expo-router';

import type { WorkItem } from '@/canvas/models';
import { openCanvasLink } from '@/features/content/links';

/** Planner notes open Easel's note screen; everything else follows its Canvas link. */
export function openWorkItem(item: WorkItem, baseUrl: string) {
  if (item.kind === 'note') {
    router.push({ pathname: '/planner-note/[noteId]', params: { noteId: item.plannableId } });
  } else if (item.htmlUrl) {
    openCanvasLink(item.htmlUrl, baseUrl);
  }
}

export const canOpenWorkItem = (item: WorkItem) => item.kind === 'note' || Boolean(item.htmlUrl);
