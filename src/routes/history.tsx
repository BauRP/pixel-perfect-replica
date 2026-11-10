import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Clock, Heart, FolderDown, Route as RouteIcon, Play, Pause, Download, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/sw/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAdapters, withTimeout, type ClipMeta } from "@/lib/sw/engine";
import { genreNameById } from "@/lib/sw/catalog";
import { notify } from "@/lib/sw/notify";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "История и избранное — SoundWorld AR" }, { name: "description", content: "Настоящие сохранённые фрагменты SoundWorld AR" }] }),
  component: HistoryPage,
});

type LibraryData={last:ClipMeta[];fav:ClipMeta[];exp:ClipMeta[]};
type Playback={state:"playing"|"paused"|"stopped";clipId:string};
function Empty({ icon:I,title,text }: {icon:typeof Clock;title:string;text:string}) {
  return <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
    <I className="size-8 text-muted-foreground"/>
    <p className="mt-3 font-semibold">{title}</p>
    <p className="mt-1 text-sm text-muted-foreground">{text}</p>
  </div>;
}

function HistoryPage(){
  const [data,setData]=useState<LibraryData>({last:[],fav:[],exp:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [playback,setPlayback]=useState<Playback>({state:"stopped",clipId:""});
  const library=getAdapters().library;
  const reload=useCallback(async()=>{
    const results=await Promise.all([withTimeout(library.listLastThreeCompleted()),withTimeout(library.listFavorites()),withTimeout(library.listExports())]);
    const errorResult=results.find(r=>!r.ok);
    if(errorResult && !errorResult.ok){setError(errorResult.message);return;}
    const [a,b,c]=results;
    setData({last:a.ok?a.value:[],fav:b.ok?b.value:[],exp:c.ok?c.value:[]});
    setError("");
  },[library]);
  useEffect(()=>{
    let mounted=true;
    void withTimeout(library.recoverLocalMetadata()).then(r=>{if(mounted){if(!r.ok)setError(r.message);void reload();}});
    void currentStoredPlayback().then(x=>{if(mounted&&x)setPlayback(x)});
    const unsubscribe=library.observeStoredPlayback(state=>{if(mounted)setPlayback(state)});
    return ()=>{mounted=false;unsubscribe();};
  },[library,reload]);
  const execute=async<T,>(action:()=>Promise<import("@/lib/sw/engine").Result<T>>,message:string)=>{
    if(busy)return;
    setBusy(true);
    try{
      const result=await withTimeout(action());
      if(!result.ok){notify.result(result,"");setError(result.message);}
      else{if(message)notify.saved(message);await reload();}
    }catch(e){const m=e instanceof Error?e.message:"Неизвестная ошибка";setError(m);notify.error(m);}
    finally{setBusy(false);}
  };
  const clipList=(items:ClipMeta[])=><ul className="space-y-2">
    {items.map(c=>{
      const playing=playback.clipId===c.id&&playback.state==="playing";
      return <li key={c.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
        <p>{new Date(c.createdAt).toLocaleString("ru")} · {Math.round(c.durationSec)} с</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.genreIds.map(g=>genreNameById[g]??g).join(", ")||"Жанр не записан"}
          {c.recoveredProtected?" · Восстановленная запись":""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} aria-label={playing?"Пауза":"Прослушать"} className="flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50"
            onClick={()=>void execute(playing?()=>library.pauseStoredClip():()=>library.playStoredClip(c.id),"")}>
            {playing?<Pause className="size-4"/>:<Play className="size-4"/>}{playing?"Пауза":"Слушать"}
          </button>
          <button disabled={busy} aria-label={c.favorite?"Убрать из избранного":"В избранное"} aria-pressed={c.favorite}
            className="flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50"
            onClick={()=>void execute(()=>library.markFavorite(c.id,!c.favorite),c.favorite?"Убрано из избранного":"Добавлено в избранное")}>
            <Heart className={c.favorite?"size-4 fill-current text-rose-500":"size-4"}/>{c.favorite?"В избранном":"Нравится"}
          </button>
          <button disabled={busy} className="flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50"
            onClick={()=>void execute(()=>library.exportRealAudio(c.id),"Файл сохранён на телефон")}>
            <Download className="size-4"/>Сохранить
          </button>
        </div>
      </li>;
    })}
  </ul>;
  return <>
    <PageHeader title="История и избранное" back right={
      <button aria-label="Обновить записи" disabled={busy} onClick={()=>void reload()} className="grid size-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-50"><RefreshCw className="size-5"/></button>
    }/>
    <div className="px-4 py-4">
      {error&&<p role="alert" className="mb-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      <Tabs defaultValue="last">
        <TabsList className="sw-history-tabs grid h-auto min-h-12 w-full grid-cols-4">
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="last">Последние 3</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="fav">Избранное</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="exp">Сохранённое</TabsTrigger>
          <TabsTrigger className="sw-history-tab min-w-0 px-1 text-[11px] whitespace-normal leading-tight" value="trip">Путешествие</TabsTrigger>
        </TabsList>
        <TabsContent value="last" className="pt-4">
          {data.last.length?clipList(data.last):<Empty icon={Clock} title="Пока пусто" text="Здесь появятся последние три действительно созданных музыкальных фрагмента."/>}
        </TabsContent>
        <TabsContent value="fav" className="pt-4">
          {data.fav.length?clipList(data.fav):<Empty icon={Heart} title="Нет избранного" text="Добавляйте существующие записи сердечком."/>}
        </TabsContent>
        <TabsContent value="exp" className="pt-4">
          {data.exp.length?clipList(data.exp):<Empty icon={FolderDown} title="Нет сохранённых файлов" text="После настоящего экспорта файлы будут здесь."/>}
        </TabsContent>
        <TabsContent value="trip" className="pt-4">
          <Empty icon={RouteIcon} title="История музыкального путешествия" text="Пока данных нет. GPS и запись разговоров не используются."/>
        </TabsContent>
      </Tabs>
    </div>
  </>;
}
