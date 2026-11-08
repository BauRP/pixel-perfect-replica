import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Heart, SkipBack, SkipForward, Play, Pause, Download, History, Undo2, Lock, Radio, CloudRain, Footprints, Bus, Music2, Activity,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAdapters, withTimeout, type SessionState, type ClipMeta } from "@/lib/sw/engine";
import { notify } from "@/lib/sw/notify";
import { effectiveDirections, useSettings } from "@/lib/sw/settings";
import { genreNameById } from "@/lib/sw/catalog";
import { PendingBadge } from "@/components/sw/ui";
import { cn } from "@/lib/utils";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { latestRealClip } from "@/lib/sw/stored-clips";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Player — SoundWorld AR" },
      { name: "description", content: "Плеер адаптивной инструментальной музыки SoundWorld AR." },
      { property: "og:title", content: "Player — SoundWorld AR" },
      { property: "og:description", content: "Плеер адаптивной инструментальной музыки." },
    ],
  }),
  component: Player,
});

const STATE_LABEL: Record<SessionState, string> = {
  IDLE: "Готово", PREPARING: "Подготовка…", LIVE: "Живая музыка", PAUSED: "Пауза", HISTORY: "Воспроизведение из истории",
  RESERVE: "Резервный фрагмент", RECOVERING: "Восстановление…", ERROR: "Ошибка", UNAVAILABLE: "Движок не подключён",
};

function Player() {
  const s = useSettings();
  const [state, setState] = useState<SessionState>("IDLE");
  const [busy, setBusy] = useState(false);
  const [recentClips,setRecentClips]=useState<ClipMeta[]>([]);
  const [storedPlayback,setStoredPlayback]=useState<{state:"playing"|"paused"|"stopped";clipId:string}>({state:"stopped",clipId:""});
  const busyRef = useRef(false);

  useEffect(() => getAdapters().engine.observeEngineState(setState), []);
  useEffect(()=>{
    const lib=getAdapters().library;
    let mounted=true;
    void lib.listLastThreeCompleted().then(r=>{if(mounted&&r.ok)setRecentClips(r.value)});
    void currentStoredPlayback().then(x=>{if(mounted&&x)setStoredPlayback(x)});
    const off=lib.observeStoredPlayback(v=>{if(mounted)setStoredPlayback(v)});
    return ()=>{mounted=false;off()};
  },[]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return; // debounce rapid taps
    busyRef.current = true;
    setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const { engine, library } = getAdapters();
  const playing = state === "LIVE" || state === "HISTORY" || state === "RESERVE";
  const live = state === "LIVE";
  const latestClip = latestRealClip(recentClips);
  const hasClip = !!latestClip; // only real, verified and completed files

  const onPlay = () => run(async () => {
    const r = storedPlayback.state==="playing"
      ? await withTimeout(library.pauseStoredClip())
      : storedPlayback.state==="paused" && storedPlayback.clipId
        ? await withTimeout(library.playStoredClip(storedPlayback.clipId))
        : await withTimeout(playing ? engine.pauseSession() : engine.startLiveSession(s));
    notify.result(r, playing ? "Пауза" : "Запуск сессии");
  });
  const onNext = () => run(async () => notify.result(await withTimeout(engine.requestNextVariation(s)), "Запрошена новая вариация"));
  const onHeart = () => run(async () => {
    if(!latestClip)return;
    const r=await withTimeout(library.markFavorite(latestClip.id,!latestClip.favorite));
    if(r.ok)setRecentClips(prev=>prev.map(c=>c.id===latestClip.id?{...c,favorite:!c.favorite}:c));
    notify.result(r,"Изменено избранное");
  });
  const onExport = () => run(async () => {
    if(!latestClip)return;
    const r = await withTimeout(library.exportRealAudio(latestClip.id));
    if (r.ok) notify.saved("Файл сохранён на телефон"); else notify.result(r, "");
  });

  const dirs = effectiveDirections(s);
  const genreSummary = s.allowedAllGenres
    ? "Все жанры"
    : dirs.filter((d) => !d.includes("-")).map((d) => genreNameById[d]).slice(0, 2).join(", ") ||
      dirs.slice(0, 2).map((d) => genreNameById[d]).join(", ");

  return (
    <div className="flex flex-col px-5 pt-safe">
      <div className="flex items-center justify-between pt-2">
        <span className="font-display text-[11px] tracking-[0.3em] text-muted-foreground">SOUNDWORLD AR</span>
        <Link to="/history" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-xs font-semibold hover:bg-secondary">
          <History className="size-4 text-primary" /> История и избранное
        </Link>
      </div>

      {/* Cover: decorative illustration, not AI album art */}
      <div className="sw-player-cover relative mt-5 aspect-square w-full overflow-hidden rounded-[2rem] bg-cover-art shadow-card" role="img" aria-label="Декоративная обложка, не созданная ИИ">
        <div className="absolute inset-[18%] rounded-full border border-foreground/10 animate-breathe" />
        <div className="absolute inset-[32%] rounded-full border border-foreground/15" />
        <div className="absolute inset-[44%] rounded-full bg-background/40 backdrop-blur-sm" />
        <span className="absolute bottom-3 right-4 text-[10px] text-foreground/60">иллюстрация</span>
      </div>

      <div className="mt-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Живая музыка</h1>
          <p className="truncate text-sm text-muted-foreground">{genreSummary} · настроение {s.mood > 0 ? `+${s.mood}` : s.mood}</p>
        </div>
        <span aria-live="polite" className={cn("mt-1 shrink-0 rounded-full px-3 py-1 text-xs font-semibold", state === "UNAVAILABLE" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary")}>
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* Mic activity: truthful inactive state */}
      <div className="mt-4 flex h-10 items-center gap-3 rounded-xl border border-dashed border-border px-3 text-xs text-muted-foreground">
        <Activity className="size-4" />
        <div className="h-px flex-1 bg-border" />
        <span>Микрофон не подключён — нет сигнала</span>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button aria-label="В избранное (сердце)" aria-pressed={latestClip?.favorite??false} disabled={busy || !hasClip} onClick={onHeart} className="grid size-12 place-items-center rounded-full text-muted-foreground hover:text-heart">
          <Heart className={cn("size-6",latestClip?.favorite&&"fill-current text-rose-500")} />
        </button>
        <button aria-label="Предыдущий фрагмент" disabled={busy || !hasClip} onClick={() => void run(async()=>{
          if(!latestClip)return;
          notify.result(await withTimeout(library.playStoredClip(latestClip.id)),"Воспроизведение сохранённого фрагмента");
        })} className="grid size-14 place-items-center rounded-full text-foreground disabled:opacity-35">
          <SkipBack className="size-7" fill="currentColor" />
        </button>
        <button aria-label={playing || storedPlayback.state==="playing" ? "Пауза" : "Играть"} disabled={busy} onClick={onPlay} className="grid size-20 place-items-center rounded-full bg-primary text-primary-foreground shadow-play transition-transform active:scale-95 disabled:opacity-70">
          {playing || storedPlayback.state==="playing" ? <Pause className="size-8" fill="currentColor" /> : <Play className="ml-1 size-8" fill="currentColor" />}
        </button>
        <button aria-label="Следующая вариация" disabled={busy} onClick={onNext} className="grid size-14 place-items-center rounded-full text-foreground">
          <SkipForward className="size-7" fill="currentColor" />
        </button>
        <button aria-label="Сохранить на телефон" disabled={busy || !hasClip} onClick={onExport} className="grid size-12 place-items-center rounded-full text-muted-foreground hover:text-foreground">
          <Download className="size-6" />
        </button>
      </div>
      {!hasClip && <p className="mt-1 text-center text-xs text-muted-foreground">Предыдущих фрагментов пока нет</p>}

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          { icon: Undo2, label: "Отменить смену атмосферы", fn: () => engine.undoAtmosphereChange() },
          { icon: Lock, label: "Сохранить атмосферу", fn: () => engine.lockAtmosphere(true) },
          { icon: Radio, label: "Вернуться к живой музыке", fn: () => engine.startLiveSession(s) },
        ].map((a) => (
          <button
            key={a.label}
            disabled={busy}
            aria-disabled={!live}
            onClick={() => run(async () => notify.result(await withTimeout(a.fn()), a.label))}
            className={cn("flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface p-2 text-center text-[11px] leading-tight", !live && "opacity-55")}
          >
            <a.icon className="size-5 text-primary" /> {a.label}
          </button>
        ))}
      </div>

      <section aria-labelledby="compass" className="mt-5 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 id="compass" className="text-sm font-semibold">Музыкальный компас</h2>
          <PendingBadge />
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {[
            { icon: CloudRain, label: "Дождь", v: "нет данных" },
            { icon: Footprints, label: "Ходьба", v: "нет данных" },
            { icon: Bus, label: "Транспорт", v: "нет данных" },
            { icon: Music2, label: "Жанр", v: genreSummary || "—" },
          ].map((f) => (
            <li key={f.label} className="flex items-center gap-2 rounded-xl bg-background/50 px-3 py-2.5">
              <f.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{f.label}</span>
              <span className="ml-auto truncate text-muted-foreground">{f.v}</span>
            </li>
          ))}
        </ul>
        {s.musicOnlyMode && <p className="mt-3 text-xs text-muted-foreground">Включён режим «Без анализа окружения».</p>}
      </section>
      <div className="h-4" />
    </div>
  );
}
