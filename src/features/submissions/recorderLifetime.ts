import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { Linking } from 'react-native';

import type { LocalFile } from '@/canvas/uploads';
import { timestampName } from '@/features/files/upload';

export const MAX_SECONDS = 10 * 60;
export const BARS = 36;
export type RecorderError = 'start' | 'stop' | 'attach' | 'settings';
export type RecorderView = {
  phase: 'idle' | 'starting' | 'recording' | 'stopping' | 'review' | 'denied';
  duration: number;
  take: number;
  levels: number[];
  uri: string | null;
  error: RecorderError | null;
};
export const initialRecorderView = (): RecorderView => ({
  phase: 'idle',
  take: 0,
  duration: 0,
  levels: Array(BARS).fill(0),
  uri: null,
  error: null,
});
const level = (db: number | undefined) =>
  db === undefined ? 0 : Math.max(0, Math.min(1, (db + 55) / 50));

// Serialize only these recorder sheets, including obsolete in-flight preparation
// and mode cleanup. A reopened sheet cannot acquire mode until its predecessor
// has finished cleanup. This is not an app-wide/native audio-session lock.
let modeTail = Promise.resolve();
let nextTake = 0;
async function acquireMode() {
  const previous = modeTail;
  let release!: () => void;
  modeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

/** One committed Recorder lifetime. No translated text is stored here. Expo's
 * useAudioRecorder owns object disposal; never manually release its shared object.
 * Already-started native calls/permission dialogs cannot be undone by this guard. */
export function createRecorderLifetime(
  recorder: AudioRecorder,
  publish: (view: RecorderView) => void,
  announce: (action: 'recording' | 'recorded', duration: number) => void,
) {
  let alive = true;
  let view = initialRecorderView();
  let claimed = false;
  let accepted = false;
  let revision = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let releaseMode: (() => void) | undefined;
  let modeAttempted = false;
  let prepareAttempted = false;
  let stopAttempted = false;
  const update = (patch: Partial<RecorderView>) => {
    view = { ...view, ...patch };
    if (alive) publish(view);
  };
  const clearTicker = () => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  };
  const stopNative = async () => {
    if (!prepareAttempted || stopAttempted) return;
    stopAttempted = true;
    await recorder.stop();
  };
  const cleanup = async () => {
    clearTicker();
    try {
      await stopNative();
    } catch {
      /* Hook may already have disposed the object. */
    }
    let failed = false;
    if (modeAttempted) {
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        failed = true;
      }
    }
    modeAttempted = false;
    prepareAttempted = false;
    releaseMode?.();
    releaseMode = undefined;
    return failed;
  };
  const fail = (reason: RecorderError) => {
    claimed = false;
    update({ phase: 'idle', uri: null, error: reason });
  };
  const stop = async (statusFailed = false) => {
    if (!alive || claimed || view.phase !== 'recording') return;
    claimed = true;
    clearTicker();
    update({ phase: 'stopping' });
    let final = view.duration;
    let uri: string | null = null;
    let failed = statusFailed;
    try {
      final = recorder.getStatus().durationMillis;
    } catch {
      failed = true;
    }
    try {
      await stopNative();
      if (alive) uri = recorder.uri;
      if (!uri) failed = true;
    } catch {
      failed = true;
    }
    failed = (await cleanup()) || failed;
    if (!alive) return;
    if (failed) {
      fail('stop');
      return;
    }
    claimed = false;
    update({ phase: 'review', duration: final, uri, error: null });
    announce('recorded', final);
  };
  const start = async () => {
    if (!alive || claimed || !['idle', 'denied'].includes(view.phase)) return;
    claimed = true; // Before the first await or React render.
    revision = ++nextTake;
    accepted = false;
    stopAttempted = false;
    update({ phase: 'starting', take: revision, error: null, uri: null });
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!alive) return;
      if (!permission.granted) {
        claimed = false;
        update({ phase: 'denied' });
        return;
      }
      releaseMode = await acquireMode();
      if (!alive) {
        await cleanup();
        return;
      }
      modeAttempted = true;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!alive) {
        await cleanup();
        return;
      }
      prepareAttempted = true;
      await recorder.prepareToRecordAsync();
      if (!alive) {
        await cleanup();
        return;
      }
      recorder.record();
      claimed = false;
      update({ phase: 'recording', duration: 0, levels: Array(BARS).fill(0) });
      const take = revision;
      ticker = setInterval(() => {
        if (!alive || claimed || revision !== take || view.phase !== 'recording') return;
        try {
          const status = recorder.getStatus();
          update({
            duration: status.durationMillis,
            levels: [...view.levels.slice(1), level(status.metering)],
          });
          if (status.durationMillis >= MAX_SECONDS * 1000) void stop();
        } catch {
          void stop(true);
        }
      }, 100);
      announce('recording', 0);
    } catch {
      await cleanup();
      if (alive) fail('start');
    }
  };
  const close = () => {
    if (!alive) return;
    alive = false;
    revision++;
    clearTicker();
    // Pending start/stop owns its cleanup, so it cannot race a second stop or
    // unlock the mode lease while native preparation is still running.
    if (!claimed) {
      claimed = true;
      void cleanup();
    }
  };
  return {
    start,
    stop: () => stop(),
    close,
    discard(expectedUri: string, generation: number) {
      if (
        !alive ||
        claimed ||
        generation !== revision ||
        view.phase !== 'review' ||
        view.uri !== expectedUri
      )
        return;
      revision++;
      update({ ...initialRecorderView() });
    },
    attach(
      expectedUri: string,
      generation: number,
      fileName: string,
      onAttach: (file: LocalFile) => void,
    ) {
      if (
        !alive ||
        claimed ||
        accepted ||
        generation !== revision ||
        view.phase !== 'review' ||
        view.uri !== expectedUri
      )
        return;
      claimed = true;
      let payload: LocalFile;
      try {
        const file = new File(expectedUri);
        payload = {
          uri: expectedUri,
          name: timestampName(fileName, 'm4a'),
          size: file.exists ? file.size : null,
          mimeType: 'audio/mp4',
        };
      } catch {
        claimed = false;
        update({ error: 'attach' });
        return;
      }
      accepted = true; // Even a throwing caller cannot receive the same take twice.
      try {
        onAttach(payload);
      } catch {
        update({ error: 'attach' });
      }
      claimed = false;
    },
    async settings() {
      if (!alive || claimed || view.phase !== 'denied') return;
      claimed = true;
      try {
        await Linking.openSettings();
      } catch {
        if (alive) update({ error: 'settings' });
      }
      if (alive) claimed = false;
    },
  };
}
