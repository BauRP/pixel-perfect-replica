import { useEffect, useRef, useState } from "react";
import { Bug, ClipboardCopy, RefreshCw, ChevronDown } from "lucide-react";
import { Section } from "@/components/sw/ui";
import { androidSensorsAvailable, getNativePerformanceSnapshot, sensorStatus } from "@/lib/sw/native-sensors";
import { currentAudioSinkStatus } from "@/lib/sw/native-pcm";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { getSettingsSnapshot } from "@/lib/sw/settings";
import { buildSafeDiagnosticsReport } from "@/lib/sw/safe-diagnostics-report";
import { buildSupportReport, copySupportReport, readFreezeEvidence } from "@/lib/sw/freeze-report";
import { inspectFermataPackage } from "@/lib/sw/fermata-native";

/** The very last Settings section. It does not start any microphone or audio.
 * No native requests or timers are made until the user opens the report. */
export function ErrorReportPanel() {
  const [expanded,setExpanded]=useState(false);
  const [loading,setLoading]=useState(false);
  const [report,setReport]=useState("");
  const [copyMessage,setCopyMessage]=useState("");
  const [updatedAt,setUpdatedAt]=useState(0);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false};},[]);

  const refresh=async()=>{
    if(loading)return;
    setLoading(true);
    setCopyMessage("");
    try {
      const [evidenceResult,sensorsResult,performanceResult,pcmResult,wavResult,fermataResult]=
        await Promise.allSettled([
          readFreezeEvidence(),sensorStatus(),getNativePerformanceSnapshot(),
          currentAudioSinkStatus(),currentStoredPlayback(),inspectFermataPackage(),
        ]);
      const value=<T,>(entry:PromiseSettledResult<T>):T|null =>
        entry.status==="fulfilled"?entry.value:null;
      const diagnostic=buildSafeDiagnosticsReport({
        android:androidSensorsAvailable(),
        musicOnly:getSettingsSnapshot().musicOnlyMode,
        active:false,stepsOnly:false,stepCount:null,
        sensors:value(sensorsResult),
        performance:value(performanceResult),
        pcm:value(pcmResult),
        wav:value(wavResult),
        fermata:value(fermataResult),
      });
      if(alive.current){
        setReport(buildSupportReport(value(evidenceResult),diagnostic));
        setUpdatedAt(Date.now());
      }
    } catch {
      if(alive.current) setReport("SoundWorld AR · Не удалось прочитать отчёт. Повторите попытку.");
    } finally {if(alive.current)setLoading(false);}
  };

  const toggle=()=>{
    if(expanded){setExpanded(false);return;}
    setExpanded(true);
    void refresh();
  };

  const copy=async()=>{
    if(!report || loading)return;
    setCopyMessage("Копирование…");
    const ok=await copySupportReport(report);
    if(alive.current)setCopyMessage(ok
      ?"Отчёт скопирован. Вставь его в сообщение ChatGPT."
      :"Копирование недоступно. Выдели текст отчёта ниже и скопируй.");
  };

  return <Section title="Помощь и диагностика">
    <button type="button" aria-expanded={expanded}
      aria-controls="sw-error-report-panel"
      onClick={toggle}
      className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium">
      <Bug className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">Отчёт об ошибках</span>
      <ChevronDown className="size-4 text-muted-foreground" style={{
        transform:expanded?"rotate(180deg)":"none",
      }} aria-hidden="true" />
    </button>
    {expanded && <div id="sw-error-report-panel" className="space-y-3 border-t border-border px-3 py-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Если приложение зависло, перезапусти его и снова открой этот раздел.
        Сохранённый отчёт поможет отличить блокировку Android от WebView.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Отчёт хранится локально. Звуки, разговоры, местоположение, названия файлов
        и содержимое других приложений не записываются. Это не полный Logcat.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading||!report}
          onClick={()=>void copy()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          <ClipboardCopy className="size-4" /> Скопировать отчёт
        </button>
        <button type="button" disabled={loading}
          onClick={()=>void refresh()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-xs disabled:opacity-50">
          <RefreshCw className="size-4" /> Обновить
        </button>
      </div>
      {copyMessage && <p role="status" className="text-xs text-muted-foreground">{copyMessage}</p>}
      {updatedAt>0 && <p className="text-xs text-muted-foreground">
        Обновлён: {new Date(updatedAt).toLocaleString("ru-RU")}
      </p>}
      <textarea aria-label="Текст отчёта об ошибках" readOnly
        value={loading?"Собираем локальные сведения…":report}
        rows={15}
        className="w-full resize-y rounded-lg border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground"
        onFocus={e=>e.currentTarget.select()}
      />
      <p className="text-xs text-muted-foreground">
        Работает внутри LDPlayer и MuMu. Если отчёт появился, скопируй его и пришли сюда.
      </p>
    </div>}
  </Section>;
}
