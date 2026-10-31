import { randomUUID } from 'expo-crypto';
import type { PickedFromTool } from './toolContent';

export type ToolLaunchTarget = {
  accountId: string;
  client: object;
  courseId: string;
  assignmentId: string;
  toolId: string;
  toolName: string | undefined;
};
type Editor = {
  context: object;
  accepts: (toolId: string) => boolean;
  receive: (content: PickedFromTool) => boolean;
  launch?: string;
};
type Launch = {
  editor: Editor;
  slot: string;
  target: ToolLaunchTarget;
  claim?: object;
  done: boolean;
};
const editors = new Map<string, Editor>();
const launches = new Map<string, Launch>();
const legacy = new Map<string, (content: PickedFromTool) => void>();
const listeners = new Set<() => void>();
let revision = 0;
export const toolLaunchRevision = () => revision;
export function subscribeToolLaunches(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  revision++;
  for (const listener of listeners) listener();
}

/** Compatibility is exclusively for legacy receivers, never an owned live editor. */
export function receivePicks(slot: string, receiver: (content: PickedFromTool) => void) {
  legacy.set(slot, receiver);
  return () => {
    if (legacy.get(slot) === receiver) legacy.delete(slot);
  };
}
export function handToSubmitForm(slot: string, content: PickedFromTool) {
  if (editors.has(slot)) return false;
  const receiver = legacy.get(slot);
  if (!receiver) return false;
  receiver(content);
  return true;
}
export function revokeToolLaunch(token: string | undefined, target?: ToolLaunchTarget) {
  if (!token || (target && !lookup(token, target))) return;
  const launch = launches.get(token);
  launches.delete(token);
  if (launch?.editor.launch === token) launch.editor.launch = undefined;
  if (launch) changed();
}
export function registerToolEditor(slot: string, editor: Editor) {
  revokeToolLaunch(editors.get(slot)?.launch);
  editors.set(slot, editor);
  return () => {
    revokeToolLaunch(editor.launch);
    if (editors.get(slot) === editor) editors.delete(slot);
  };
}
export function beginToolLaunch(slot: string, context: object, target: ToolLaunchTarget) {
  const editor = editors.get(slot);
  if (!editor || editor.context !== context || !editor.accepts(target.toolId)) return null;
  revokeToolLaunch(editor.launch);
  const token = randomUUID();
  editor.launch = token;
  launches.set(token, { editor, slot, target: { ...target }, done: false });
  changed();
  return token;
}
function lookup(token: string | undefined, target: ToolLaunchTarget) {
  const launch = token ? launches.get(token) : undefined;
  if (!launch || editors.get(launch.slot) !== launch.editor || launch.editor.launch !== token)
    return null;
  if (
    (Object.keys(launch.target) as (keyof ToolLaunchTarget)[]).some(
      (key) => launch.target[key] !== target[key],
    )
  )
    return null;
  return launch;
}
export function toolLaunchCurrent(token: string | undefined, target: ToolLaunchTarget) {
  const launch = lookup(token, target);
  return !!launch && !launch.done && launch.editor.accepts(target.toolId);
}
/** Exclusive producer claim. Release permits retry; completion permanently consumes the token.
 * Adoption is synchronous and explicit, before any upload-store emission. A transfer that
 * has already entered addUploads cannot be rolled back by a later synchronous subscriber.
 */
export function claimToolLaunch(token: string | undefined, target: ToolLaunchTarget) {
  const launch = lookup(token, target);
  if (!launch || launch.claim || !toolLaunchCurrent(token, target)) return null;
  const identity = {};
  launch.claim = identity;
  const current = () =>
    lookup(token, target) === launch &&
    launch.claim === identity &&
    launch.editor.accepts(target.toolId);
  return {
    current,
    accept(content: PickedFromTool, start?: () => void) {
      if (!current() || launch.done || !launch.editor.receive(content)) return false;
      if (!current()) return false;
      launch.done = true;
      start?.();
      return true;
    },
    release() {
      if (launch.claim === identity && !launch.done) launch.claim = undefined;
    },
    complete() {
      if (!current()) return false;
      revokeToolLaunch(token);
      // Revocation notifies subscribers synchronously; one may open a newer tool.
      return (
        editors.get(launch.slot) === launch.editor &&
        launch.editor.launch === undefined &&
        launch.editor.accepts(target.toolId)
      );
    },
  };
}
