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
import { latestRealClip, previousRealClip, nextRealClip } from "@/lib/sw/stored-clips";
import { verifiedWavProgress, wavTimestamp, type WavProgress } from "@/lib/sw/wav-progress";
import { observeRawSound, observeRawSteps, observeMicrophoneLevel, sensorStatus } from "@/lib/sw/native-sensors";
import { AmbientStabilizer, StepPaceEstimator, type Atmosphere } from "@/lib/sw/environment-smoothing";

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
  const [storedPlayback,setStoredPlayback]=useState<{state:"playing"|"paused"|"stopped"|"preparing";clipId:string}>({state:"stopped",clipId:""});
  const busyRef = useRef(false);
  const [wavProgress,setWavProgress]=useState<WavProgress|null>(null);
  const [seekDraft,setSeekDraft]=useState<number|null>(null);
  useEffect(()=>setSeekDraft(null),[storedPlayback.clipId]);
  const [lastEnvironment,setLastEnvironment] = useState<{kind:Atmosphere;at:number}|null>(null);
  const [lastActivity,setLastActivity] = useState<{kind:"walking"|"running";at:number}|null>(null);
  const [microphone,setMicrophone] = useState<{active:boolean;input:string;at:number}>({active:false,input:"",at:0});

  useEffect(() => getAdapters().engine.observeEngineState(setState), []);
  useEffect(()=>{
    const lib=getAdapters().library;
    let mounted=true;
    // Recover completed WAVs whose catalog update was interrupted by a crash.
    // Native recovery runs on the disk worker, never on the Android UI thread.
    void (async()=>{
      await withTimeout(lib.recoverLocalMetadata());
      if(!mounted)return;
      const r=await withTimeout(lib.listJourney());
      if(mounted&&r.ok)setRecentClips(r.value);
    })();
    void currentStoredPlayback().then(x=>{if(mounted&&x)setStoredPlayback(x)});
    const off=lib.observeStoredPlayback(v=>{if(mounted){setStoredPlayback(v);if(v.error)notify.error(v.error)}});
    return ()=>{mounted=false;off()};
  },[]);
  useEffect(()=>{
    if(storedPlayback.state==="stopped"){
      setWavProgress(null);
      return;
    }
    let active=true,reading=false;
    const refresh=async()=>{
      if(reading)return;
      reading=true;
      try {
        const status=await currentStoredPlayback();
        if(!active||!status)return;
        if(status.state==="stopped"){
          setWavProgress(null);
          setStoredPlayback(status);
        } else if(status.clipId===storedPlayback.clipId) {
          setWavProgress(verifiedWavProgress(status.positionMs,status.durationMs));
        }
      } finally {reading=false;}
    };
    void refresh();
    const interval=window.setInterval(()=>void refresh(),1000);
    return ()=>{active=false;window.clearInterval(interval)};
  },[storedPlayback.state,storedPlayback.clipId]);
  useEffect(()=>{
    const stabilizer=new AmbientStabilizer();
    const pace=new StepPaceEstimator();
    let mounted=true;
    void sensorStatus().then(s=>{if(mounted&&s?.recording)setMicrophone({active:true,input:s.actualInput,at:Date.now()})});
    const offSound=observeRawSound(event=>{
      const stable=stabilizer.update(event);
      if(stable)setLastEnvironment({kind:stable.atmosphere,at:Date.now()});
    });
    const offSteps=observeRawSteps(event=>{
      const next=pace.ingest(event.timestamp);
      if(next.activity!=="unknown")setLastActivity({kind:next.activity,at:Date.now()});
    });
    const offMicrophone=observeMicrophoneLevel(event=>setMicrophone({active:true,input:event.input,at:Date.now()}));
    // Never show old sensor readings as if detection was still active.
    const interval=window.setInterval(()=>{
      const now=Date.now();
      setLastEnvironment(x=>x&&now-x.at>7000?null:x);
      setLastActivity(x=>x&&now-x.at>5000?null:x);
      setMicrophone(x=>x.active&&now-x.at>5000?{active:false,input:"",at:0}:x);
    },3000);
    return ()=>{mounted=false;offSound();offSteps();offMicrophone();window.clearInterval(interval)};
  },[]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return; // debounce rapid taps
    busyRef.current = true;
    setBusy(true);
    try { await fn(); } catch(e) { notify.error(e instanceof Error?e.message:"Ошибка команды"); } finally { busyRef.current = false; setBusy(false); }
  };

  const { engine, library } = getAdapters();
  const playing = state === "LIVE" || state === "HISTORY" || state === "RESERVE";
  const live = state === "LIVE";
  const latestClip = latestRealClip(recentClips);
  const currentClip = recentClips.find(c=>c.id===storedPlayback.clipId) ?? latestClip;
  const previousClip = previousRealClip(recentClips,storedPlayback.clipId);
  const nextClip = nextRealClip(recentClips,storedPlayback.clipId);
  const hasClip = !!currentClip; // only real, verified and completed files

  const onPlay = () => run(async () => {
    const playSaved = !playing && storedPlayback.state==="stopped" &&
      state==="UNAVAILABLE" && latestClip;
    const r = storedPlayback.state==="playing"
      ? await withTimeout(library.pauseStoredClip())
      : storedPlayback.state==="paused" && storedPlayback.clipId
        ? await withTimeout(library.playStoredClip(storedPlayback.clipId))
        : playSaved
          ? await withTimeout(library.playStoredClip(latestClip.id))
          : await withTimeout(playing ? engine.pauseSession() : engine.startLiveSession(s));
    notify.result(r, playSaved?"Воспроизведение сохранённого WAV":playing?"Пауза":"Запуск сессии");
  });
  const onNext = () => run(async () => {
    if(state==="UNAVAILABLE"){
      if(!nextClip) return;
      notify.result(await withTimeout(library.playStoredClip(nextClip.id)),"Воспроизведение следующего сохранённого WAV");
    } else {
      notify.result(await withTimeout(engine.requestNextVariation(s)),"Запрошена новая вариация");
    }
  });
  const commitSeek = () => {
    if(seekDraft===null || !wavProgress || !storedPlayback.clipId)return;
    const positionMs=seekDraft,clipId=storedPlayback.clipId;
    setSeekDraft(null);
    void run(async()=>notify.result(await withTimeout(library.seekStoredClip(clipId,positionMs)),"Перемотка WAV запрошена"));
  };
  const onHeart = () => run(async () => {
    if(!currentClip)return;
    const r=await withTimeout(library.markFavorite(currentClip.id,!currentClip.favorite));
    if(r.ok)setRecentClips(prev=>prev.map(c=>c.id===currentClip.id?{...c,favorite:!c.favorite}:c));
    if(r.ok)notify.saved("Избранное обновлено");else notify.result(r,"");
  });
  const onExport = () => run(async () => {
    if(!currentClip)return;
    const r = await withTimeout(library.exportRealAudio(currentClip.id));
    if (r.ok) notify.saved("Файл сохранён на телефон"); else notify.result(r, "");
  });

  const dirs = effectiveDirections(s);
  const genreSummary = s.allowedAllGenres
    ? "Все жанры"
    : dirs.filter((d) => !d.includes("-")).map((d) => genreNameById[d]).slice(0, 2).join(", ") ||
      dirs.slice(0, 2).map((d) => genreNameById[d]).join(", ");

  return (
    <div className="sw-player flex flex-col px-3">
      <div className="sticky top-0 z-20 -mx-3 flex items-center justify-between gap-2 border-b border-border/40 bg-background/95 px-3 pb-1.5 pt-safe backdrop-blur-md">
        <span className="font-display text-[10px] tracking-[0.22em] text-muted-foreground">SOUNDWORLD AR</span>
        <Link to="/history" className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[11px] font-semibold hover:bg-secondary">
          <History className="size-4 text-primary" /> История и избранное
        </Link>
      </div>

      {/* Cover: decorative illustration, not AI album art */}
      <div className="sw-player-cover relative mt-2 w-full overflow-hidden rounded-2xl bg-cover-art shadow-card" role="img" aria-label="Декоративная обложка, не созданная ИИ">
        <div className="absolute left-1/2 top-1/2 size-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/10 animate-breathe" />
        <div className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/15" />
        <div className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/40 backdrop-blur-sm" />
        <span className="absolute bottom-2 right-3 text-[10px] text-foreground/60">иллюстрация</span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Живая музыка</h1>
          <p className="truncate text-xs text-muted-foreground">{genreSummary} · настроение {s.mood > 0 ? `+${s.mood}` : s.mood}</p>
        </div>
        <span aria-live="polite" className={cn("mt-0.5 max-w-[50%] shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold", state === "UNAVAILABLE" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary")}>
          {storedPlayback.state==="playing"?"Воспроизведение WAV":storedPlayback.state==="paused"?"Пауза WAV":storedPlayback.state==="preparing"?"Подготовка WAV…":STATE_LABEL[state]}
        </span>
      </div>

      {/* Mic activity: truthful inactive state */}
      <div className="mt-2 flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground">
        <Activity className="size-4" />
        <div className="h-px flex-1 bg-border" />
        <span>{microphone.active ? `Микрофон: ${microphone.input || "активен"}` : "Микрофон выключен — нет сигнала"}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button aria-label="В избранное (сердце)" aria-pressed={currentClip?.favorite??false} disabled={busy || !hasClip} onClick={onHeart} className="grid size-11 place-items-center rounded-full text-muted-foreground hover:text-heart">
          <Heart className={cn("size-5",currentClip?.favorite&&"fill-current text-rose-500")} />
        </button>
        <button aria-label="Предыдущий фрагмент" disabled={busy || !previousClip} onClick={() => void run(async()=>{
          if(!previousClip)return;
          notify.result(await withTimeout(library.playStoredClip(previousClip.id)),"Воспроизведение предыдущего фрагмента");
        })} className="grid size-11 place-items-center rounded-full text-foreground disabled:opacity-35">
          <SkipBack className="size-5" fill="currentColor" />
        </button>
        <button aria-label={playing || storedPlayback.state==="playing" ? "Пауза" : "Играть"} disabled={busy||storedPlayback.state==="preparing"} onClick={onPlay} className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-play transition-transform active:scale-95 disabled:opacity-70">
          {playing || storedPlayback.state==="playing" ? <Pause className="size-6" fill="currentColor" /> : <Play className="ml-1 size-6" fill="currentColor" />}
        </button>
        <button aria-label={state==="UNAVAILABLE"?"Следующий сохранённый фрагмент":"Следующая вариация"} disabled={busy||(state==="UNAVAILABLE"&&!nextClip)} onClick={onNext} className="grid size-11 place-items-center rounded-full text-foreground">
          <SkipForward className="size-5" fill="currentColor" />
        </button>
        <button aria-label="Сохранить на телефон" disabled={busy || !hasClip} onClick={onExport} className="grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground">
          <Download className="size-5" />
        </button>
      </div>
      {wavProgress && storedPlayback.state!=="stopped" &&
        <div className="mt-1.5 space-y-1" aria-label="Фактическая длительность сохранённого WAV">
          <input type="range" aria-label="Перемотать сохранённый WAV"
            min={0} max={wavProgress.durationMs} step={1000}
            value={seekDraft??wavProgress.positionMs}
            onChange={e=>setSeekDraft(Number(e.target.value))}
            onPointerUp={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek}
            disabled={busy||storedPlayback.state==="preparing"}
            className="w-full accent-primary" />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{wavTimestamp(wavProgress.positionMs)}</span>
            <span>{wavTimestamp(wavProgress.durationMs)}</span>
          </div>
        </div>}
      {!hasClip && <p className="mt-1 text-center text-xs text-muted-foreground">Предыдущих фрагментов пока нет</p>}
      {state==="UNAVAILABLE" && hasClip &&
        <p className="mt-1 text-center text-xs text-muted-foreground">Нейросеть пока не подключена. Кнопка Play воспроизводит последний настоящий WAV.</p>}

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[
          { icon: Undo2, label: "Отменить смену атмосферы", fn: () => engine.undoAtmosphereChange() },
          { icon: Lock, label: "Сохранить атмосферу", fn: () => engine.lockAtmosphere(true) },
          { icon: Radio, label: "Вернуться к живой музыке", fn: () => engine.startLiveSession(s) },
        ].map((a) => (
          <button
            key={a.label}
            disabled={busy || !live}
            aria-disabled={!live}
            onClick={() => run(async () => notify.result(await withTimeout(a.fn()), a.label))}
            className={cn("flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface px-1 py-1.5 text-center text-[10px] leading-tight", !live && "opacity-55")}
          >
            <a.icon className="size-4 text-primary" /> {a.label}
          </button>
        ))}
      </div>

      <section aria-labelledby="compass" className="mt-2 rounded-xl border border-border bg-surface p-2.5">
        <div className="flex items-center justify-between">
          <h2 id="compass" className="text-sm font-semibold">Музыкальный компас</h2>
          <PendingBadge />
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            { icon: CloudRain, label: "Дождь", v: lastEnvironment?.kind==="rain"?"Обнаружен":"нет данных" },
            { icon: Footprints, label: "Ходьба", v: lastActivity?.kind==="walking"?"Обнаружена":lastActivity?.kind==="running"?"Бег":"нет данных" },
            { icon: Bus, label: "Транспорт", v: lastEnvironment?.kind==="traffic"?"Обнаружен":"нет данных" },
            { icon: Music2, label: "Жанр", v: genreSummary || "—" },
          ].map((f) => (
            <li key={f.label} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-background/50 px-2 py-1.5">
              <f.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{f.label}</span>
              <span className="ml-auto min-w-0 truncate text-muted-foreground">{f.v}</span>
            </li>
          ))}
        </ul>
        {s.musicOnlyMode && <p className="mt-3 text-xs text-muted-foreground">Включён режим «Без анализа окружения».</p>}
      </section>
      <div className="h-2" />
    </div>
  );
}
