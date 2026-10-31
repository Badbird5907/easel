/*
 * Which features need the background task (notifications, widgets, course
 * sync). It stays registered while any of them does. The background task file
 * supplies the registrar; features only say what they need, so neither
 * imports the other.
 */

export type BackgroundReason = 'notifications' | 'widgets' | 'sync';

const wants: Record<BackgroundReason, boolean> = { notifications: false, widgets: false, sync: false };
let registrar: ((enabled: boolean) => Promise<void>) | null = null;
let chain: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Wants arrive one by one as the app starts; wait for them to settle before changing anything. */
const SETTLE_MS = 1_500;

function apply() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const wanted = Object.values(wants).some(Boolean);
    // One registration change at a time, so quick toggles can't race.
    chain = chain.then(() => registrar?.(wanted)).catch(() => {});
  }, SETTLE_MS);
}

/** Called once by the background task file. */
export function setBackgroundRegistrar(register: (enabled: boolean) => Promise<void>) {
  registrar = register;
}

/** Records whether one feature needs background runs; the task is registered to match. */
export function setBackgroundWant(reason: BackgroundReason, enabled: boolean) {
  wants[reason] = enabled;
  apply();
}
