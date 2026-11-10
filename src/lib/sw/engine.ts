/**
 * Native integration contracts for SoundWorld AR.
 * Phase 1 ships ONLY "unavailable" adapters: every call returns an explicit
 * UNAVAILABLE / NOT_IMPLEMENTED result. The next developer replaces these with
 * real adapters (the approved Fermata model, YAMNet, Android services) via
 * `registerAdapters()`. UI never calls microphone/AI directly.
 */
import type { Settings } from "./settings";

export type SessionState =
  | "IDLE" | "PREPARING" | "LIVE" | "PAUSED" | "HISTORY"
  | "RESERVE" | "RECOVERING" | "ERROR" | "UNAVAILABLE";

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; code: "UNAVAILABLE" | "NOT_IMPLEMENTED" | "PERMISSION_DENIED" | "TIMEOUT" | "ERROR"; message: string };

export const NOT_CONNECTED = "Музыкальный движок пока не подключён";

const unavailable = <T = void>(message = NOT_CONNECTED): Promise<Result<T>> =>
  Promise.resolve({ ok: false, code: "UNAVAILABLE", message });

export type Unsubscribe = () => void;

export interface MusicEngine {
  checkAvailability(): Promise<Result<{ model: string }>>;
  startLiveSession(settings: Settings): Promise<Result>;
  pauseSession(): Promise<Result>;
  resumeSession(): Promise<Result>;
  requestNextVariation(settings: Settings): Promise<Result>;
  undoAtmosphereChange(): Promise<Result>;
  lockAtmosphere(locked: boolean): Promise<Result>;
  stopLiveSession(): Promise<Result>;
  observeEngineState(cb: (s: SessionState) => void): Unsubscribe;
  observePlaybackState(cb: (p: { positionSec: number; segmentSec: 120; clipId?: string }) => void): Unsubscribe;
}

export interface EnvironmentEvent {
  label: string; // YAMNet class
  confidence: number; // 0..1
  timestamp: number;
  source: "headsetMic" | "phoneMic" | "bluetoothMic";
}
export interface EnvironmentAnalyzer {
  checkAvailability(): Promise<Result>;
  startCapture(): Promise<Result>;
  stopCapture(): Promise<Result>;
  observeEnvironment(cb: (e: EnvironmentEvent) => void): Unsubscribe;
}

export interface AudioDeviceRouter {
  currentActualMicrophone(): Promise<Result<{ name: string; kind: string }>>;
  observeInputOutputChanges(cb: () => void): Unsubscribe;
  chooseBestSupportedRoute(): Promise<Result>;
  verifyActualRoute(): Promise<Result<{ input: string; output: string }>>;
}

export type Activity = "walking" | "running" | "transport" | "rest" | "unknown";
export interface ActivityProvider {
  observeWalkingRunningTransportRest(cb: (a: { activity: Activity; confidence: number }) => void): Unsubscribe;
}

export interface ClipMeta {
  id: string;
  createdAt: number;
  durationSec: number;
  genreIds: string[];
  instrumentIds?: string[]; // real request metadata when captured
  recoveredProtected?: boolean; // recovered WAV preserved without creating a fake favorite
  mood: number;
  speed: number;
  uri?: string; // real local audio file
  favorite: boolean;
  exportedUri?: string;
}
export interface MusicLibrary {
  listLastThreeCompleted(): Promise<Result<ClipMeta[]>>;
  listFavorites(): Promise<Result<ClipMeta[]>>;
  markFavorite(clipId: string, value: boolean): Promise<Result>;
  listExports(): Promise<Result<ClipMeta[]>>;
  exportRealAudio(clipId: string): Promise<Result<{ uri: string }>>;
  deleteTemporary(clipId: string): Promise<Result>;
  recoverLocalMetadata(): Promise<Result>;
  playStoredClip(clipId: string): Promise<Result>;
  pauseStoredClip(): Promise<Result>;
  stopStoredClip(): Promise<Result>;
  observeStoredPlayback(cb:(state:{state:"playing"|"paused"|"stopped"|"preparing";clipId:string})=>void):Unsubscribe;
}

export interface BackgroundAudioBridge {
  startForegroundMediaService(): Promise<Result>;
  stopForegroundMediaService(): Promise<Result>;
  onAudioFocusLoss(cb: (reason: "call" | "other") => void): Unsubscribe;
  onHeadsetDisconnected(cb: () => void): Unsubscribe;
}

export interface PerformanceMonitor {
  snapshot(): Promise<Result<{ tempC?: number; ramMb?: number; battery?: number; glitches?: number; elapsedSec?: number }>>;
  applyBatteryMode(mode: Settings["batteryMode"]): Promise<Result>;
}

export interface Permissions {
  microphone(): Promise<Result<"granted" | "denied" | "prompt">>;
  requestMicrophone(): Promise<Result<"granted" | "denied">>;
}

const noopUnsub: Unsubscribe = () => {};

export interface Adapters {
  engine: MusicEngine; environment: EnvironmentAnalyzer; router: AudioDeviceRouter; activity: ActivityProvider;
  library: MusicLibrary; background: BackgroundAudioBridge; performance: PerformanceMonitor; permissions: Permissions;
}

export const unavailableAdapters: Adapters = {
  engine: {
    checkAvailability: () => unavailable(),
    startLiveSession: () => unavailable(),
    pauseSession: () => unavailable(),
    resumeSession: () => unavailable(),
    requestNextVariation: () => unavailable(),
    undoAtmosphereChange: () => unavailable(),
    lockAtmosphere: () => unavailable(),
    stopLiveSession: () => unavailable(),
    observeEngineState: (cb) => {
      cb("UNAVAILABLE");
      return noopUnsub;
    },
    observePlaybackState: () => noopUnsub,
  },
  environment: {
    checkAvailability: () => unavailable("Анализ окружения (YAMNet) не подключён"),
    startCapture: () => unavailable("Микрофон не подключён"),
    stopCapture: () => unavailable("Микрофон не подключён"),
    observeEnvironment: () => noopUnsub,
  },
  router: {
    currentActualMicrophone: () => unavailable("Источник микрофона недоступен: не подключено"),
    observeInputOutputChanges: () => noopUnsub,
    chooseBestSupportedRoute: () => unavailable("Маршрутизация звука не подключена"),
    verifyActualRoute: () => unavailable("Маршрутизация звука не подключена"),
  },
  activity: { observeWalkingRunningTransportRest: () => noopUnsub },
  library: {
    listLastThreeCompleted: () => Promise.resolve({ ok: true, value: [] }),
    listFavorites: () => Promise.resolve({ ok: true, value: [] }),
    markFavorite: () => unavailable("Нет готового фрагмента: движок не подключён"),
    listExports: () => Promise.resolve({ ok: true, value: [] }),
    exportRealAudio: () => unavailable("Нет аудиофайла для сохранения: движок не подключён"),
    deleteTemporary: () => unavailable("Нет временных фрагментов"),
    recoverLocalMetadata: () => Promise.resolve({ ok: true, value: undefined }),
    playStoredClip: () => unavailable("Нет настоящей сохранённой записи"),
    pauseStoredClip: () => unavailable("Файл не воспроизводится"),
    stopStoredClip: () => unavailable("Файл не воспроизводится"),
    observeStoredPlayback: () => noopUnsub,
  },
  background: {
    startForegroundMediaService: () => unavailable("Фоновое воспроизведение Android не подключено"),
    stopForegroundMediaService: () => unavailable("Фоновое воспроизведение Android не подключено"),
    onAudioFocusLoss: () => noopUnsub,
    onHeadsetDisconnected: () => noopUnsub,
  },
  performance: {
    snapshot: () => unavailable("Нет данных: модуль не подключён"),
    applyBatteryMode: () => unavailable("Нет данных: модуль не подключён"),
  },
  permissions: {
    microphone: () => unavailable("Нативные разрешения не подключены"),
    requestMicrophone: () => unavailable("Нативные разрешения не подключены"),
  },
};

let adapters: Adapters = unavailableAdapters;

/** Dependency injection point for the native (Capacitor/Kotlin) implementation. */
export function registerAdapters(next: Partial<Adapters>) {
  adapters = { ...adapters, ...next };
}
export const getAdapters = () => adapters;

/** Rolling "last 3" rule: evict oldest temp clip that is neither favorite nor exported. */
export function addCompletedClip(list: ClipMeta[], clip: ClipMeta, max = 3): { kept: ClipMeta[]; evicted: ClipMeta[] } {
  const all = [...list, clip];
  const evicted: ClipMeta[] = [];
  const temps = () => all.filter((c) => !c.favorite && !c.exportedUri);
  while (temps().length > max) {
    const oldest = temps().sort((a, b) => a.createdAt - b.createdAt)[0]!;
    all.splice(all.indexOf(oldest), 1);
    evicted.push(oldest);
  }
  return { kept: all, evicted };
}

/** Run an adapter call with a timeout so the UI never hangs. */
export async function withTimeout<T>(p: Promise<Result<T>>, ms = 5000): Promise<Result<T>> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<T>>((res) => {
    t = setTimeout(() => res({ ok: false, code: "TIMEOUT", message: "Нет ответа от модуля" }), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}
