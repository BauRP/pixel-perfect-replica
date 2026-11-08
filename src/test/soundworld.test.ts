import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { GENRES, ALL_DIRECTION_IDS, INSTRUMENTS } from "@/lib/sw/catalog";
import {
  DEFAULT_SETTINGS, applySkipAllGenres, effectiveDirections, groupState, loadSettings, migrateSettings, saveSettings,
  setDislike, toggleFavoriteInstrument, type KeyValueStorage,
} from "@/lib/sw/settings";
import { addCompletedClip, unavailableAdapters, type ClipMeta } from "@/lib/sw/engine";
import { TABS } from "@/components/sw/AppShell";

const mem = (): KeyValueStorage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };

describe("catalog", () => {
  it("15 groups x 9 unique subgenres = 150 directions", () => {
    expect(GENRES).toHaveLength(15);
    GENRES.forEach((g) => expect(g.subgenres).toHaveLength(9));
    expect(new Set(ALL_DIRECTION_IDS).size).toBe(150);
    expect(new Set(GENRES.flatMap((g) => g.subgenres.map((s) => s.name))).size).toBe(135);
  });
  it("8 instrument categories", () => expect(INSTRUMENTS.map((c) => c.name)).toEqual(["Клавишные", "Электронные", "Гитары", "Струнные", "Ударные", "Духовые", "Оркестровые", "Народные"]));
});

describe("settings", () => {
  it("defaults", () => {
    const d = DEFAULT_SETTINGS;
    expect([d.mood, d.speed, d.environmentReaction, d.atmosphereTransition, d.diversity, d.activityMode, d.segmentSeconds, d.useOfEnvironmentSounds, d.stepsInfluence, d.batteryMode])
      .toEqual([0, 0, "medium", "auto", "moderate", "auto", 120, "controlOnly", "normal", "auto"]);
    expect(d.favoriteInstrumentIds).toEqual([]);
    expect(d.dislikes).toEqual({});
  });
  it("skip selects all 150", () => expect(effectiveDirections(applySkipAllGenres(DEFAULT_SETTINGS))).toHaveLength(150));
  it("defends restored preferences against unknown, duplicate and invalid catalog IDs",()=>{
    const r=migrateSettings({chosenGenreIds:["g01-s01","g01-s01","bogus",12],
      favoriteInstrumentIds:["i1-01","i1-01","evil","g01-s01"],dislikes:{"evil":"excluded","i1-01":"notPreferred"}});
    expect(r.chosenGenreIds).toEqual(["g01-s01"]);
    expect(r.favoriteInstrumentIds).toEqual(["i1-01"]);
    expect(r.dislikes).toEqual({"i1-01":"notPreferred"});
  });
  it("never mutates default director rules through a fresh migration",()=>{
    const first=migrateSettings(null);
    first.directorRules[0]!.enabled=true;
    first.chosenGenreIds.push("g01-s01");
    const again=migrateSettings(null);
    expect(again.directorRules[0]!.enabled).toBe(false);
    expect(again.chosenGenreIds).toEqual([]);
  });
  it("migrates microphone preferences and rejects invalid values", () => {
    expect(migrateSettings({}).microphonePreference).toBe("auto");
    expect(migrateSettings({microphonePreference:"headset"}).microphonePreference).toBe("headset");
    expect(migrateSettings({microphonePreference:"unsafe"}).microphonePreference).toBe("auto");
  });
  it("persists across reload", () => {
    const st = mem();
    saveSettings(st, { ...DEFAULT_SETTINGS, mood: -4, onboardingCompleted: true });
    const r = loadSettings(st);
    expect(r.mood).toBe(-4);
    expect(r.onboardingCompleted).toBe(true);
  });
  it("clamps to integers and forces 120 s", () => {
    const r = migrateSettings({ mood: 9.7, speed: -2.4, segmentSeconds: 30 });
    expect([r.mood, r.speed, r.segmentSeconds]).toEqual([5, -2, 120]);
  });
  it("partial group state", () => {
    expect(groupState("g01", new Set(["g01-s01"]))).toBe("partial");
    expect(groupState("g01", new Set(GENRES[0]!.subgenres.map((s) => s.id)))).toBe("all");
  });
  it("whole genre exclusion is kept and unknown IDs are rejected",()=>{
    const s=setDislike(DEFAULT_SETTINGS,"g01","excluded");
    expect(s.dislikes["g01"]).toBe("excluded");
    expect(setDislike(s,"invalid-id","excluded")).toBe(s);
    expect(toggleFavoriteInstrument(s,"invalid-id").next).toBe(s);
  });
  it("exclusion wins over favorite", () => {
    let s = toggleFavoriteInstrument(DEFAULT_SETTINGS, "i1-01").next;
    s = setDislike(s, "i1-01", "excluded");
    expect(s.favoriteInstrumentIds).not.toContain("i1-01");
    expect(toggleFavoriteInstrument(s, "i1-01").conflict).toBe("excluded");
  });
});

describe("engine contracts", () => {
  it("unavailable engine never reports success", async () => {
    const r = await unavailableAdapters.engine.startLiveSession(DEFAULT_SETTINGS);
    expect(r.ok).toBe(false);
    expect((await unavailableAdapters.library.exportRealAudio("x")).ok).toBe(false);
  });
  it("4th clip evicts oldest temp, keeps favorites", () => {
    const c = (id: string, t: number, favorite = false): ClipMeta => ({ id, createdAt: t, durationSec: 120, genreIds: [], mood: 0, speed: 0, favorite });
    const { kept, evicted } = addCompletedClip([c("a", 1, true), c("b", 2), c("c", 3), c("d", 4)], c("e", 5));
    expect(evicted.map((x) => x.id)).toEqual(["b"]);
    expect(kept.map((x) => x.id)).toContain("a");
  });
});

describe("navigation", () => {
  it("exactly three tabs in order", () => expect(TABS.map((t) => t.label)).toEqual(["Player", "Studio", "Настройки"]));
  it("routes resolve", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const p of ["/", "/studio", "/settings", "/onboarding", "/history", "/studio/tastes", "/studio/director", "/settings/diagnostics"]) {
      expect(router.matchRoutes(p).at(-1)?.routeId).not.toBe("__root__");
    }
  });
});
