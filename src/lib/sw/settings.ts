import { useSyncExternalStore } from "react";
import { ALL_DIRECTION_IDS, ALL_SUBGENRE_IDS, GENRES, INSTRUMENTS } from "./catalog";

export const SETTINGS_SCHEMA_VERSION = 2;
export const STORAGE_KEY = "soundworld.settings";

export type Reaction3 = "weak" | "medium" | "strong";
export type Transition = "smooth" | "fast" | "auto";
export type Diversity = "familiar" | "moderate" | "experimental";
export type ActivityMode = "auto" | "walking" | "running" | "rest" | "transport";
export type EnvSoundUse = "controlOnly" | "mixProcessed";
export type StepsInfluence = "weak" | "normal" | "active";
export type BatteryMode = "auto" | "maxPerformance";
export type MicrophonePreference = "auto" | "headset" | "phone";
export type DislikeLevel = "notPreferred" | "excluded";

export interface DirectorRule {
  id: string;
  enabled: boolean;
}

export interface Settings {
  schemaVersion: number;
  onboardingCompleted: boolean;
  allowedAllGenres: boolean;
  chosenGenreIds: string[]; // subgenre ids (parents derived)
  mood: number; // -5..5
  speed: number; // -3..3
  favoriteInstrumentIds: string[];
  dislikes: Record<string, DislikeLevel>; // instrument or genre id
  environmentReaction: Reaction3;
  atmosphereTransition: Transition;
  diversity: Diversity;
  activityMode: ActivityMode;
  segmentSeconds: 120;
  useOfEnvironmentSounds: EnvSoundUse;
  stepsInfluence: StepsInfluence;
  afterCallAutoResume: boolean;
  batteryMode: BatteryMode;
  musicOnlyMode: boolean;
  autoAudioRouting: boolean;
  microphonePreference: MicrophonePreference;
  directorRules: DirectorRule[];
}

export const DIRECTOR_RULES: { id: string; trigger: string; effect: string }[] = [
  { id: "steps-drums", trigger: "Шаги", effect: "больше акцентов ударных" },
  { id: "rain-soft", trigger: "Дождь", effect: "мягче атмосфера" },
  { id: "transport-pads", trigger: "Транспорт", effect: "плотнее пэды и бас" },
  { id: "birds-melody", trigger: "Птицы", effect: "светлее мелодия" },
  { id: "quiet-sparse", trigger: "Тишина", effect: "меньше слоёв" },
];

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  onboardingCompleted: false,
  allowedAllGenres: false,
  chosenGenreIds: [],
  mood: 0,
  speed: 0,
  favoriteInstrumentIds: [],
  dislikes: {},
  environmentReaction: "medium",
  atmosphereTransition: "auto",
  diversity: "moderate",
  activityMode: "auto",
  segmentSeconds: 120,
  useOfEnvironmentSounds: "controlOnly",
  stepsInfluence: "normal",
  afterCallAutoResume: true,
  batteryMode: "auto",
  musicOnlyMode: false,
  autoAudioRouting: true,
  microphonePreference: "auto",
  directorRules: DIRECTOR_RULES.map((r) => ({ id: r.id, enabled: false })),
};

/** Isolated settings defaults prevent an accidental nested-array mutation from
 * changing the defaults for all future resets/first launches. */
const freshDefaults = (): Settings => ({
  ...DEFAULT_SETTINGS,
  chosenGenreIds: [],
  favoriteInstrumentIds: [],
  dislikes: {},
  directorRules: DEFAULT_SETTINGS.directorRules.map(rule=>({...rule})),
});
const validSubgenres = new Set(ALL_SUBGENRE_IDS);
const validDirections = new Set(ALL_DIRECTION_IDS);
const validInstruments = new Set(INSTRUMENTS.flatMap(group=>group.items.map(x=>x.id)));
const validDislikes = new Set([...validDirections,...validInstruments]);
const cleanIds = (raw:unknown, allowed:ReadonlySet<string>):string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((id):id is string=>typeof id==="string" && allowed.has(id)))] : [];

const clampInt = (v: unknown, min: number, max: number, def: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : def;
const oneOf = <T extends string>(v: unknown, opts: readonly T[], def: T): T =>
  opts.includes(v as T) ? (v as T) : def;

/** Validate + migrate any persisted blob into a valid current Settings object. */
export function migrateSettings(raw: unknown): Settings {
  const d = freshDefaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const r = raw as Partial<Record<keyof Settings, unknown>>;
  const dislikes: Record<string, DislikeLevel> = {};
  if (r.dislikes && typeof r.dislikes === "object" && !Array.isArray(r.dislikes)) {
    for (const [k, v] of Object.entries(r.dislikes as object)) {
      if (validDislikes.has(k) && (v === "notPreferred" || v === "excluded")) dislikes[k] = v;
    }
  }
  const rulesIn = Array.isArray(r.directorRules) ? (r.directorRules as DirectorRule[]) : [];
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    onboardingCompleted: r.onboardingCompleted === true,
    allowedAllGenres: r.allowedAllGenres === true,
    chosenGenreIds: cleanIds(r.chosenGenreIds,validSubgenres),
    mood: clampInt(r.mood, -5, 5, d.mood),
    speed: clampInt(r.speed, -3, 3, d.speed),
    // exclusion wins over favorites
    favoriteInstrumentIds: cleanIds(r.favoriteInstrumentIds,validInstruments).filter((id) => dislikes[id] !== "excluded"),
    dislikes,
    environmentReaction: oneOf(r.environmentReaction, ["weak", "medium", "strong"] as const, d.environmentReaction),
    atmosphereTransition: oneOf(r.atmosphereTransition, ["smooth", "fast", "auto"] as const, d.atmosphereTransition),
    diversity: oneOf(r.diversity, ["familiar", "moderate", "experimental"] as const, d.diversity),
    activityMode: oneOf(r.activityMode, ["auto", "walking", "running", "rest", "transport"] as const, d.activityMode),
    segmentSeconds: 120,
    useOfEnvironmentSounds: oneOf(r.useOfEnvironmentSounds, ["controlOnly", "mixProcessed"] as const, d.useOfEnvironmentSounds),
    stepsInfluence: oneOf(r.stepsInfluence, ["weak", "normal", "active"] as const, d.stepsInfluence),
    afterCallAutoResume: typeof r.afterCallAutoResume === "boolean" ? r.afterCallAutoResume : d.afterCallAutoResume,
    batteryMode: oneOf(r.batteryMode, ["auto", "maxPerformance"] as const, d.batteryMode),
    musicOnlyMode: r.musicOnlyMode === true,
    autoAudioRouting: typeof r.autoAudioRouting === "boolean" ? r.autoAudioRouting : d.autoAudioRouting,
    microphonePreference: oneOf(r.microphonePreference, ["auto", "headset", "phone"] as const, d.microphonePreference),
    directorRules: DIRECTOR_RULES.map((def) => ({
      id: def.id,
      enabled: rulesIn.find((x) => x?.id === def.id)?.enabled === true,
    })),
  };
}

/** Onboarding "Пропустить" = all 150 directions allowed. */
export function applySkipAllGenres(s: Settings): Settings {
  return {
    ...s,
    allowedAllGenres: true,
    chosenGenreIds: GENRES.flatMap((g) => g.subgenres.map((x) => x.id)),
    onboardingCompleted: true,
  };
}

/** Selected directions incl. parent groups that are fully selected. */
export function effectiveDirections(s: Settings): string[] {
  if (s.allowedAllGenres) return [...ALL_DIRECTION_IDS];
  const set = new Set(s.chosenGenreIds);
  const out: string[] = [];
  for (const g of GENRES) {
    if (g.subgenres.every((x) => set.has(x.id))) out.push(g.id);
    for (const x of g.subgenres) if (set.has(x.id)) out.push(x.id);
  }
  return out;
}

export type GroupState = "none" | "partial" | "all";
export function groupState(groupId: string, selected: Set<string>): GroupState {
  const g = GENRES.find((x) => x.id === groupId)!;
  const n = g.subgenres.filter((x) => selected.has(x.id)).length;
  return n === 0 ? "none" : n === g.subgenres.length ? "all" : "partial";
}

/** Sets an instrument favorite; returns a conflict string if it is excluded. */
export function toggleFavoriteInstrument(s: Settings, id: string): { next: Settings; conflict?: string } {
  if (s.dislikes[id] === "excluded") return { next: s, conflict: "excluded" };
  const has = s.favoriteInstrumentIds.includes(id);
  return {
    next: {
      ...s,
      favoriteInstrumentIds: has ? s.favoriteInstrumentIds.filter((x) => x !== id) : [...s.favoriteInstrumentIds, id],
    },
  };
}

/** Setting exclusion removes the same item from favorites (exclusion wins). */
export function setDislike(s: Settings, id: string, level: DislikeLevel | null): Settings {
  const dislikes = { ...s.dislikes };
  if (level) dislikes[id] = level;
  else delete dislikes[id];
  return {
    ...s,
    dislikes,
    favoriteInstrumentIds: level === "excluded" ? s.favoriteInstrumentIds.filter((x) => x !== id) : s.favoriteInstrumentIds,
  };
}

// ---------- store ----------

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function loadSettings(storage: KeyValueStorage | undefined): Settings {
  if (!storage) return freshDefaults();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? migrateSettings(JSON.parse(raw)) : freshDefaults();
  } catch {
    return freshDefaults();
  }
}

export function saveSettings(storage: KeyValueStorage | undefined, s: Settings) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* low storage: keep in-memory */
  }
}

const browserStorage = (): KeyValueStorage | undefined =>
  typeof window !== "undefined" ? window.localStorage : undefined;

let state: Settings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function hydrateSettings() {
  if (hydrated) return;
  state = loadSettings(browserStorage());
  hydrated = true;
  emit();
}

export function updateSettings(fn: (s: Settings) => Settings) {
  state = fn(state);
  saveSettings(browserStorage(), state);
  emit();
}

export function resetSettings() {
  state = freshDefaults();
  browserStorage()?.removeItem(STORAGE_KEY);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function getSettingsSnapshot(): Settings { return state; }

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => state, () => DEFAULT_SETTINGS);
}
export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => hydrated, () => false);
}
