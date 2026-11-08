# SoundWorld AR — Phase 1 handoff

## Implemented in Phase 1 (tested)
- 3-tab shell: Player / Studio / Настройки (fixed order, labels).
- First-run «Музыкальные вкусы»: 15 groups × 9 subgenres, group check (blue) separate from expand chevron, partial state, search, «Пропустить» = all 150 allowed. Shown once.
- Studio: 11 numbered settings with round «?» help dialogs; nested Вкусы, Любимые инструменты (8 categories), Нелюбимое (Не предпочитаю / Исключить, exclusion wins), Музыкальный режиссёр.
- Player: heart, prev, play/pause, next, «Сохранить на телефон», atmosphere controls, Музыкальный компас, mic-activity strip — all wired to typed adapters, truthful «не подключён» states.
- История и избранное: Последние 3 / Избранное / Сохранённое / Путешествие — genuinely empty.
- Настройки: auto routing, after-call resume, music-only mode, battery mode, Безопасная прогулка info, permissions info, licenses/privacy, dev diagnostics, confirmed reset.
- Versioned settings schema (`src/lib/sw/settings.ts`, `migrateSettings`) persisted in localStorage.
- Tests: `bunx vitest run` (catalog counts, defaults, persistence, clamping, partial groups, exclusion conflict, unavailable engine, last-3 eviction, 3 tabs, routes). Type check: `npx tsgo -b --noEmit`.

## Requires future native integration
`src/lib/sw/engine.ts` defines MusicEngine, EnvironmentAnalyzer, AudioDeviceRouter, ActivityProvider, MusicLibrary, BackgroundAudioBridge, PerformanceMonitor, Permissions. Phase 1 registers only `unavailableAdapters` (every call returns `{ ok:false, code:"UNAVAILABLE" }`). Call `registerAdapters({...})` at startup with real implementations (Magenta RealTime 2 Small, YAMNet, MediaSessionService, audio focus, step sensor). `addCompletedClip` implements the last-3 eviction rule. Only a real engine may emit `LIVE`.

## Blocked by platform
This environment builds a React/TanStack web app; it cannot compile Kotlin or produce an APK. To wrap for Android: `npm i @capacitor/core @capacitor/cli @capacitor/android`, `npx cap init "SoundWorld AR" kz.soundworld.ar`, build a static client bundle, `npx cap add android`, set minSdk 31 / target per installed SDK, then implement the adapters as Capacitor plugins. Not done or tested here.

## Privacy
No network calls for music UI (only Google Fonts stylesheet — self-host for full offline). Mic never opens before Play; no audio stored or sent.
