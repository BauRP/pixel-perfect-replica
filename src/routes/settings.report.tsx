import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClipboardCopy, RefreshCw, Bug } from "lucide-react";
import { PageHeader, Section } from "@/components/sw/ui";
import { androidSensorsAvailable, getNativePerformanceSnapshot, sensorStatus } from "@/lib/sw/native-sensors";
import { currentAudioSinkStatus } from "@/lib/sw/native-pcm";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { buildSafeDiagnosticsReport } from "@/lib/sw/safe-diagnostics-report";
import { buildSupportReport, copySupportReport, readFreezeEvidence } from "@/lib/sw/freeze-report";

export const Route = createFileRoute("/settings/report")({
  component: ErrorReportPage,
});

function ErrorReportPage() {
  const [report,setReport] = useState("");
  const [loading,setLoading] = useState(true);
  const [copyMessage,setCopyMessage] = useState("");
  const [reportTime,setReportTime] = useState(0);

  const refresh = async () => {
    setLoading(true);
    setCopyMessage("");
    // All native reads have independent deadlines. No microphone starts,
    // permissions, new WAVs, network requests, or sample collection.
    try {
      const [evidenceResult,sensorsResult,performanceResult,pcmResult,wavResult] =
        await Promise.allSettled([
          readFreezeEvidence(),sensorStatus(),getNativePerformanceSnapshot(),
          currentAudioSinkStatus(),currentStoredPlayback(),
        ]);
      const get = <T,>(r:PromiseSettledResult<T>):T|null=>
        r.status==="fulfilled" ? r.value : null;
      const evidence=get(evidenceResult);
      const snapshots=buildSafeDiagnosticsReport({
        android:androidSensorsAvailable(),
        musicOnly:false,active:false,stepsOnly:false,stepCount:null,
        sensors:get(sensorsResult),performance:get(performanceResult),
        pcm:get(pcmResult),wav:get(wavResult),
      });
      setReport(buildSupportReport(evidence,snapshots));
      setReportTime(Date.now());
    } catch {
      setReport("SoundWorld AR · Не удалось подготовить локальный отчёт. Повторите попытку.");
    } finally {setLoading(false);}
  };

  useEffect(()=>{
    let mounted=true;
    // State setters are guarded via local flag on unmount to avoid stale
    // navigation updates, while the underlying native operations remain bounded.
    const load=async()=>{await refresh();};
    void load();
    return ()=>{mounted=false;void mounted;};
  },[]);

  const copy=async()=>{
    if(!report || loading)return;
    setCopyMessage("Копирование…");
    const success=await copySupportReport(report);
    setCopyMessage(success
      ?"Отчёт скопирован. Вставь его в сообщение ChatGPT."
      :"Автоматическое копирование недоступно. Выдели и скопируй текст ниже.");
  };

  return <>
    <PageHeader title="Отчёт об ошибках" back subtitle="Для поиска зависаний без Android Studio" />
    <div className="space-y-3 px-3 py-3">
      <Section>
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bug className="size-5 text-primary" /> Журнал ошибок и зависаний
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Приложение автоматически отмечает длительные зависания Android и WebView.
            Если оно перестало отвечать, перезапусти его и снова открой этот раздел.
            Здесь появятся сохранённые сведения о предыдущем зависании.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Отчёт остаётся на устройстве до копирования. Звук, разговоры,
            местоположение, имена файлов и содержимое других приложений не собираются.
            Это не полный системный Logcat.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={loading || !report}
              onClick={()=>void copy()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <ClipboardCopy className="size-4" /> Скопировать отчёт
            </button>
            <button type="button" disabled={loading}
              onClick={()=>void refresh()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-50">
              <RefreshCw className="size-4" /> Обновить
            </button>
          </div>
          {copyMessage && <p role="status" className="text-xs text-muted-foreground">{copyMessage}</p>}
          {reportTime>0 && <p className="text-xs text-muted-foreground">
            Обновлён: {new Date(reportTime).toLocaleString("ru-RU")}
          </p>}
          <textarea aria-label="Текст отчёта об ошибках" readOnly
            value={loading?"Собираем локальные сведения…":report}
            rows={17}
            className="w-full resize-y rounded-lg border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground"
            onFocus={e=>e.currentTarget.select()}
          />
          <p className="text-xs text-muted-foreground">
            Для LDPlayer и MuMu ничего устанавливать не нужно. Если видишь отчёт,
            нажми «Скопировать отчёт» и пришли текст сюда.
          </p>
        </div>
      </Section>
    </div>
  </>;
}
