import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Heart, FolderDown, Route as RouteIcon, Play, Pause, Square, Download, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/sw/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAdapters, withTimeout, type ClipMeta } from "@/lib/sw/engine";
import { genreNameById } from "@/lib/sw/catalog";
import { notify } from "@/lib/sw/notify";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { groupRealJourney } from "@/lib/sw/journey";
import { wavTimestamp, type WavProgress } from "@/lib/sw/wav-progress";
import { verifiedHistoryProgress, verifiedHistorySeek, reconcileHistoryPlayback, PlaybackEventOrder, LatestHistoryRequest, historyClipCanStop } from "@/lib/sw/history-wav-seek";
import { HISTORY_DISK_SCAN_TIMEOUT_MS, historyIsEmpty, type HistoryLoadPhase } from "@/lib/sw/history-loading";
import { normalizeHistoryClips } from "@/lib/sw/history-metadata";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "История и избранное — SoundWorld AR" }, { name: "description", content: "Настоящие сохранённые фрагменты SoundWorld AR" }] }),
  component: HistoryPage,
});

type LibraryData={last:ClipMeta[];fav:ClipMeta[];exp:ClipMeta[];journey:ClipMeta[]};
type Playback={state:"playing"|"paused"|"stopped"|"preparing";clipId:string};
function Empty({ icon:I,title,text }: {icon:typeof Clock;title:string;text:string}) {
  return <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
    <I className="size-8 text-muted-foreground"/>
    <p className="mt-3 font-semibold">{title}</p>
    <p className="mt-1 text-sm text-muted-foreground">{text}</p>
  </div>;
}

function HistoryPage(){
  const [data,setData]=useState<LibraryData>({last:[],fav:[],exp:[],journey:[]});
  const [loadPhase,setLoadPhase]=useState<HistoryLoadPhase>("loading");
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const playbackOrder=useRef(new PlaybackEventOrder());
  const loadOrder=useRef(new LatestHistoryRequest());
  const [error,setError]=useState("");
  const [playback,setPlayback]=useState<Playback>({state:"stopped",clipId:""});
  const [measured,setMeasured]=useState<{clipId:string;progress:WavProgress}|null>(null);
  const [seekDraft,setSeekDraft]=useState<{clipId:string;positionMs:number}|null>(null);
  const library=getAdapters().library;
  const reload=useCallback(async()=>{
    const ticket=loadOrder.current.begin();
    setLoadPhase("loading");
    // All four native list requests use ONE serial disk queue. The exported
    // list checks actual MediaStore content hashes. A 5s deadline causes
    // false errors on larger genuine WAV libraries.
    const results=await Promise.all([
      withTimeout(library.listLastThreeCompleted(),HISTORY_DISK_SCAN_TIMEOUT_MS),
      withTimeout(library.listFavorites(),HISTORY_DISK_SCAN_TIMEOUT_MS),
      withTimeout(library.listExports(),HISTORY_DISK_SCAN_TIMEOUT_MS),
      withTimeout(library.listJourney(),HISTORY_DISK_SCAN_TIMEOUT_MS),
    ]);
    if(!loadOrder.current.accepts(ticket))return;
    const errorResult=results.find(r=>!r.ok);
    if(errorResult && !errorResult.ok){
      setError(errorResult.message);
      setLoadPhase("error");
      return;
    }
    const [a,b,c,d]=results;
    const last = normalizeHistoryClips(a.ok ? a.value : []);
    const fav = normalizeHistoryClips(b.ok ? b.value : []);
    const exp = normalizeHistoryClips(c.ok ? c.value : []);
    const journey = normalizeHistoryClips(d.ok ? d.value : []);
    setData({last:last.clips,fav:fav.clips,exp:exp.clips,journey:journey.clips});
    // A corrupt native row must not crash the whole screen or be called "empty".
    const skipped = last.skipped + fav.skipped + exp.skipped + journey.skipped;
    setError(skipped ? `Не удалось показать ${skipped} записей с повреждёнными идентификаторами. Файлы не удалены.` : "");
    setLoadPhase(skipped ? "error" : "ready");
  },[library]);
  useEffect(()=>{
    let mounted=true;
    void withTimeout(library.recoverLocalMetadata(),HISTORY_DISK_SCAN_TIMEOUT_MS).then(r=>{if(mounted){if(!r.ok)setError(r.message);void reload();}});
    // Capture the event revision BEFORE the async native read. A newer
    // MediaPlayer callback always wins over a late initial snapshot.
    const initialRevision=playbackOrder.current.snapshot();
    void currentStoredPlayback().then(x=>{
      if(mounted && playbackOrder.current.accepts(initialRevision) && x)setPlayback(x);
    });
    const unsubscribe=library.observeStoredPlayback(state=>{
      if(mounted){
        playbackOrder.current.onNativeEvent();
        setPlayback(state);
        if(state.error){setError(state.error);notify.error(state.error)}
      }
    });
    return ()=>{mounted=false;loadOrder.current.cancel();unsubscribe();};
  },[library,reload]);
  // Poll only while the History page is open and a real native WAV is active.
  // Never estimate playback time from a timer or a saved clip's metadata.
  useEffect(()=>{
    setMeasured(null);setSeekDraft(null);
    // Also watch a genuinely preparing WAV: the asynchronous native
    // "playing" event may be missed during WebView recreation.
    if(!playback.clipId || (playback.state!=="playing"&&playback.state!=="paused"&&playback.state!=="preparing"))return;
    let alive=true,reading=false;
    const refresh=async()=>{
      if(reading)return;
      reading=true;
      const revision=playbackOrder.current.snapshot();
      try{
        const status=await currentStoredPlayback();
        // Never let a slow Android callback undo a newer Pause/Stop/Play.
        if(!alive || !playbackOrder.current.accepts(revision) || !status)return;
        // An event may be lost while the History page is backgrounded.
        // Accept live native pause/stop/clip-change, but do not let an old
        // poll overwrite a newer native event delivered in the meantime.
        const change=reconcileHistoryPlayback(playback,status);
        if(change){
          setPlayback(prev=>prev.clipId===playback.clipId && prev.state===playback.state ? change:prev);
          return;
        }
        const progress=verifiedHistoryProgress(playback.clipId,status);
        setMeasured(progress?{clipId:playback.clipId,progress}:null);
      }finally{reading=false}
    };
    void refresh();
    const interval=window.setInterval(()=>void refresh(),1000);
    return ()=>{alive=false;window.clearInterval(interval)};
  },[playback.clipId,playback.state]);
  const execute=async<T,>(action:()=>Promise<import("@/lib/sw/engine").Result<T>>,
    message:string,refreshAfter=true,timeoutMs=5000)=>{
    if(busyRef.current)return;
    busyRef.current=true;
    setBusy(true);
    try{
      // Native MediaStore export hashes and reads back up to 120 seconds of
      // 48kHz stereo PCM. The normal 5s action timeout is far too short:
      // it caused false failures followed by duplicate export requests.
      const result=await withTimeout(action(),timeoutMs);
      if(!result.ok){notify.result(result,"");setError(result.message);}
      else{if(message)notify.saved(message);if(refreshAfter)await reload();}
    }catch(e){const m=e instanceof Error?e.message:"Неизвестная ошибка";setError(m);notify.error(m);}
    finally{busyRef.current=false;setBusy(false);}
  };
  const clipList=(items:ClipMeta[])=><ul className="space-y-2">
    {items.map(c=>{
      const playing=playback.clipId===c.id&&playback.state==="playing";
      const active=historyClipCanStop(c.id,playback);
      const preparing=active && playback.state==="preparing";
      const progress=active && !preparing && measured?.clipId===c.id?measured.progress:null;
      const draft=seekDraft?.clipId===c.id?seekDraft.positionMs:null;
      const seekTarget=verifiedHistorySeek(c.id,playback.clipId,draft,progress);
      return <li key={c.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
        <p>{c.createdAt > 0 ? new Date(c.createdAt).toLocaleString("ru") : "Дата неизвестна"} · {c.durationSec > 0 ? `${Math.round(c.durationSec)} с` : "Длительность неизвестна"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.genreIds.map(g=>genreNameById[g]??g).join(", ")||"Жанр не записан"}
          {c.recoveredProtected?" · Восстановленная запись":""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy||playback.state==="preparing"} aria-label={playing?"Пауза":"Прослушать"} className="flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50"
            onClick={()=>void execute(playing?()=>library.pauseStoredClip():()=>library.playStoredClip(c.id),"")}>
            {playing?<Pause className="size-4"/>:<Play className="size-4"/>}{playing?"Пауза":"Слушать"}
          </button>
          {active && <button disabled={busy} aria-label="Остановить WAV"
            className="flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50"
            onClick={()=>void execute(()=>library.stopStoredClip(),"",false)}>
            <Square className="size-4"/>Стоп
          </button>}
          <button disabled={busy} aria-label={c.favorite?"Убрать из избранного":"В избранное"} aria-pressed={c.favorite}
            className="flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50"
            onClick={()=>void execute(()=>library.markFavorite(c.id,!c.favorite),c.favorite?"Убрано из избранного":"Добавлено в избранное")}>
            <Heart className={c.favorite?"size-4 fill-current text-rose-500":"size-4"}/>{c.favorite?"В избранном":"Нравится"}
          </button>
          <button disabled={busy} className="flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50"
            onClick={()=>void execute(()=>library.exportRealAudio(c.id),"Файл сохранён на телефон",true,120000)}>
            <Download className="size-4"/>Сохранить
          </button>
        </div>
        {active && <div className="mt-3 space-y-2" aria-label="Перемотка сохранённого WAV">
          {progress
            ? <>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>{wavTimestamp(draft??progress.positionMs)}</span>
                  <span>{wavTimestamp(progress.durationMs)}</span>
                </div>
                <input type="range" min={0} max={progress.durationMs} step={1000}
                  value={draft??progress.positionMs}
                  onChange={e=>setSeekDraft({clipId:c.id,positionMs:Number(e.currentTarget.value)})}
                  disabled={busy}
                  className="w-full accent-primary"
                  aria-label="Выбрать позицию сохранённого WAV"
                  aria-valuetext={wavTimestamp(draft??progress.positionMs)}/>
                <button disabled={busy||seekTarget===null}
                  className="min-h-11 rounded-lg border border-border px-3 text-xs disabled:opacity-50"
                  onClick={()=>{
                    if(seekTarget===null)return;
                    setSeekDraft(null);
                    void execute(()=>library.seekStoredClip(c.id,seekTarget),"",false);
                  }}>Перемотать</button>
              </>
            : <p className="text-xs text-muted-foreground">{preparing?"Android подготавливает WAV. Можно остановить воспроизведение.":"Позиция WAV не подтверждена Android"}</p>}
        </div>}
      </li>;
    })}
  </ul>;
  const journeyDays = groupRealJourney(data.journey);
  const datedJourneyIds = new Set(journeyDays.flatMap(day => day.clips.map(clip => clip.id)));
  const ungroupedJourney = data.journey.filter(clip => !datedJourneyIds.has(clip.id));
  return <>
    <PageHeader title="История и избранное" back right={
      <button aria-label="Обновить записи" disabled={busy} onClick={()=>void reload()} className="grid size-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-50"><RefreshCw className="size-5"/></button>
    }/>
    <div className="px-4 py-4">
      {error&&<p role="alert" className="mb-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {loadPhase==="loading" && <p role="status" className="mb-3 text-sm text-muted-foreground">
        Проверяем настоящие WAV и сохранённые файлы Android. История не считается пустой до завершения проверки.
      </p>}
      <Tabs defaultValue="last">
        <TabsList className="sw-history-tabs grid h-auto min-h-12 w-full grid-cols-4">
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="last">Последние 3</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="fav">Избранное</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="exp">Сохранённое</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="trip">Путешествие</TabsTrigger>
        </TabsList>
        <TabsContent value="last" className="pt-4">
          {data.last.length?clipList(data.last):historyIsEmpty(loadPhase,data.last.length)?<Empty icon={Clock} title="Пока пусто" text="Здесь появятся последние три действительно созданных музыкальных фрагмента."/>:null}
        </TabsContent>
        <TabsContent value="fav" className="pt-4">
          {data.fav.length?clipList(data.fav):historyIsEmpty(loadPhase,data.fav.length)?<Empty icon={Heart} title="Нет избранного" text="Добавляйте существующие записи сердечком."/>:null}
        </TabsContent>
        <TabsContent value="exp" className="pt-4">
          {data.exp.length?clipList(data.exp):historyIsEmpty(loadPhase,data.exp.length)?<Empty icon={FolderDown} title="Нет сохранённых файлов" text="После настоящего экспорта файлы будут здесь."/>:null}
        </TabsContent>
        <TabsContent value="trip" className="pt-4">
          {data.journey.length ?
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Настоящие сохранённые фрагменты по датам. Показаны до 100 последних записей, без GPS.</p>
              {journeyDays.map(day=>(
                <section key={day.dayKey} className="space-y-2" aria-label={day.heading}>
                  <h2 className="font-semibold text-sm">{day.heading} · {day.count} фрагм. · {day.minutes} мин</h2>
                  {clipList(day.clips)}
                </section>
              ))}
              {ungroupedJourney.length > 0 && (
                <section className="space-y-2" aria-label="Записи с неполными сведениями">
                  <h2 className="font-semibold text-sm">Записи с неполными сведениями · {ungroupedJourney.length}</h2>
                  {clipList(ungroupedJourney)}
                </section>
              )}
            </div>
            : historyIsEmpty(loadPhase,data.journey.length) ? <Empty icon={RouteIcon} title="История музыкального путешествия" text="Настоящих сохранённых записей пока нет. GPS и разговоры не записываются."/> : null}
        </TabsContent>
      </Tabs>
    </div>
  </>;
}
