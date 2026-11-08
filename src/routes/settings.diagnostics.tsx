import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader, Section } from "@/components/sw/ui";
import {
  androidSensorsAvailable, observeRawSteps, observeSensorErrors, observeRawSound, observeMicrophoneLevel, sensorStatus,
  startSensorDiagnostics, stopSensorDiagnostics, getNativePerformanceSnapshot, ATMOSPHERE_RU,
  type SensorsStatus
} from "@/lib/sw/native-sensors";
import { AmbientStabilizer, StepPaceEstimator } from "@/lib/sw/environment-smoothing";
import { MusicControlPlanner, type ControlPlan } from "@/lib/sw/music-control";
import { useSettings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { buildMusicRequest } from "@/lib/sw/music-preferences";

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => ({ meta: [{ title: "Диагностика — SoundWorld AR" }] }),
  component: Diagnostics
});

function Diagnostics() {
  const settings = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [plan,setPlan] = useState<ControlPlan | null>(null);
  const request=plan?buildMusicRequest(settings,plan,[]):null;
  const [status,setStatus] = useState<SensorsStatus | null>(null);
  const [active,setActive] = useState(false);
  const [steps,setSteps] = useState("Нет подтверждённых шагов");
  const [error,setError] = useState("");
  const [environment,setEnvironment] = useState("Обстановка не определена");
  const [micInput,setMicInput] = useState("");
  const [micRms,setMicRms] = useState<number | null>(null);
  const [hardware,setHardware] = useState<{ramMb?:number;battery?:number;thermalStatus?:number;inferenceSkipped:number;lowMemory?:boolean}|null>(null);
  useEffect(()=>{
    const estimator = new StepPaceEstimator();
    const stabilizer = new AmbientStabilizer();
    const planner = new MusicControlPlanner();
    const updatePlan = () => setPlan(planner.plan(settingsRef.current,Date.now()));
    let mounted=true;
    void sensorStatus().then(s=>{if(mounted)setStatus(s)});
    void getNativePerformanceSnapshot().then(s=>{if(mounted)setHardware(s)});
    const removeSteps=observeRawSteps(e=>{
      const pace=estimator.ingest(e.timestamp);
      if (pace.activity!=="unknown"){
        setSteps((pace.activity==="running"?"Бег":"Ходьба")+" · "+pace.bpm+" шагов/мин");
        planner.observePace({bpm:pace.bpm,confidence:pace.confidence,timestamp:e.timestamp});
        updatePlan();
      }
    });
    const removeErrors=observeSensorErrors(setError);
    const removeSounds=observeRawSound(e=>{
      const stable=stabilizer.update(e);
      if(!stable)return;
      setEnvironment(stable.atmosphere+" · "+Math.round(stable.confidence*100)+"%");
      planner.observeAmbient(stable, settingsRef.current);
      updatePlan();
    });
    const removeMic=observeMicrophoneLevel(e=>{setMicInput(e.input);setMicRms(e.rms)});
    const interval=setInterval(()=>{
      if (!mounted) return;
      void getNativePerformanceSnapshot().then(x=>{if(mounted)setHardware(x)});
      updatePlan();
    },3000);
    return ()=>{mounted=false;clearInterval(interval);removeSteps();removeErrors();removeSounds();removeMic();void stopSensorDiagnostics()};
  },[]);
  const start=async()=>{
    const result=await startSensorDiagnostics(true);
    if(!result.ok) {notify.result(result,"");setError(result.message);}
    else {setActive(true);setError("");setEnvironment("Ожидание достоверного результата");}
    setStatus(await sensorStatus());
    setHardware(await getNativePerformanceSnapshot());
  };
  const stop=async()=>{await stopSensorDiagnostics();setActive(false);setMicRms(null);setPlan(null);setStatus(await sensorStatus());setHardware(await getNativePerformanceSnapshot());};
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
            <p>Источник микрофона: {active?(micInput||status?.actualInput||"Определяется"):"Не используется"}</p>
            <p>Живой уровень микрофона: {active&&micRms!==null?Math.round(micRms*1000)/10+"%":"Нет сигнала"}</p>
            <p>Датчик шагов: {status?.stepsSupported?"Найден":"Нет данных / отсутствует"}</p>
            <p>Активность: {steps}</p>
            <p>Доступная оперативная память: {hardware?.ramMb === undefined?"Нет данных":hardware.ramMb+" МБ"}</p>
            <p>Заряд батареи: {hardware?.battery === undefined?"Нет данных":hardware.battery+"%"}</p>
            <p>Тепловой статус Android: {hardware?.thermalStatus === undefined?"Нет данных":hardware.thermalStatus}</p>
            <p>Пропущенные окна анализа: {hardware?.inferenceSkipped ?? "Нет данных"}</p>
            <p>Обстановка: {status?.yamnetIncluded ? environment : ATMOSPHERE_RU.unknown}</p>
            <p>Запрошенный темп будущей музыки: {plan?.tempoBpm ?? "Нет плана"} BPM</p>
            <p>Ритм шагов для отдельной перкуссии: {plan?.stepPulseBpm ?? "Не определён"}</p>
            <p>План смены атмосферы: {plan?.transitionMs ?? "Не определён"} мс</p>
            <p>Разрешённых музыкальных направлений: {request?.genreCandidates.length ?? "Нет плана"}</p>
            <p>Исключённых инструментов: {request?.excludedInstruments.length ?? "Нет плана"}</p>
            <p>Вокал: запрещён для будущей генерации</p>
            <p className="text-xs text-muted-foreground">Это только план управления будущей генерацией, не воспроизводимый звук.</p>
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
          Разговоры не сохраняются. При наличии YAMNet кнопка запускает настоящее локальное распознавание звуков. Музыкальная генерация пока недоступна.
        </p>
      </div>
    </>
  );
}
