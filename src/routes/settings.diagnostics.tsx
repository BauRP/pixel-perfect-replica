import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Section } from "@/components/sw/ui";
import {
  androidSensorsAvailable, observeRawSteps, observeSensorErrors, sensorStatus,
  startSensorDiagnostics, stopSensorDiagnostics, ATMOSPHERE_RU,
  type SensorsStatus
} from "@/lib/sw/native-sensors";
import { StepPaceEstimator } from "@/lib/sw/environment-smoothing";
import { notify } from "@/lib/sw/notify";

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => ({ meta: [{ title: "Диагностика — SoundWorld AR" }] }),
  component: Diagnostics
});

function Diagnostics() {
  const [status,setStatus] = useState<SensorsStatus | null>(null);
  const [active,setActive] = useState(false);
  const [steps,setSteps] = useState("Нет подтверждённых шагов");
  const [error,setError] = useState("");
  useEffect(()=>{
    const estimator = new StepPaceEstimator();
    let mounted=true;
    void sensorStatus().then(s=>{if(mounted)setStatus(s)});
    const removeSteps=observeRawSteps(e=>{
      const pace=estimator.ingest(e.timestamp);
      if (pace.activity!=="unknown")setSteps((pace.activity==="running"?"Бег":"Ходьба")+" · "+pace.bpm+" шагов/мин");
    });
    const removeErrors=observeSensorErrors(setError);
    return ()=>{mounted=false;removeSteps();removeErrors();void stopSensorDiagnostics()};
  },[]);
  const start=async()=>{
    const result=await startSensorDiagnostics(true);
    if(!result.ok) {notify.result(result,"");setError(result.message);}
    else {setActive(true);setError("");}
    setStatus(await sensorStatus());
  };
  const stop=async()=>{await stopSensorDiagnostics();setActive(false);setStatus(await sensorStatus());};
  return (
    <>
      <PageHeader title="Диагностика" back subtitle="Проверка настоящих датчиков Android" />
      <div className="space-y-4 px-4 py-4">
        <Section>
          <div className="space-y-3 p-4 text-sm">
            <p>Платформа: {androidSensorsAvailable()?"Android":"Веб-версия (датчики недоступны)"}</p>
            <p>YAMNet: {status?.yamnetIncluded?"Модель найдена":"Модель не подключена"}</p>
            <p>Magenta RealTime 2 Small: не подключена</p>
            <p>Микрофон: {status?.microphoneGranted?"Разрешение есть":"Разрешение не получено"}</p>
            <p>Источник микрофона: {status?.recording?status.actualInput||"Проверяется":"Не используется"}</p>
            <p>Датчик шагов: {status?.stepsSupported?"Найден":"Нет данных / отсутствует"}</p>
            <p>Активность: {steps}</p>
            <p>Обстановка: {ATMOSPHERE_RU.unknown} (YAMNet не подключена)</p>
            {error&&<p role="alert" className="text-destructive">{error}</p>}
          </div>
        </Section>
        <div className="flex flex-wrap gap-3">
          <button className="min-h-12 rounded-xl bg-primary px-5 text-primary-foreground disabled:opacity-50"
            disabled={!androidSensorsAvailable()||active} onClick={()=>void start()}>
            Проверить микрофон и шаги
          </button>
          <button className="min-h-12 rounded-xl border border-border px-5 disabled:opacity-50"
            disabled={!active} onClick={()=>void stop()}>
            Остановить проверку
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Проверка запускается только по нажатию и выключается при уходе с экрана.
          Никакие разговоры не сохраняются. Распознавание YAMNet и музыка заработают только после установки настоящих моделей.
        </p>
      </div>
    </>
  );
}
