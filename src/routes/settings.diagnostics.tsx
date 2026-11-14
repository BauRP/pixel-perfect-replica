import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader, Section } from "@/components/sw/ui";
import {
  androidSensorsAvailable, observeRawSteps, observeSensorErrors, observeRawSound, observeMicrophoneLevel, sensorStatus,
  startSensorDiagnostics, startStepOnlyDiagnostics, stopSensorDiagnostics, getNativePerformanceSnapshot, ATMOSPHERE_RU,
  type SensorsStatus
} from "@/lib/sw/native-sensors";
import { AmbientStabilizer, StepPaceEstimator } from "@/lib/sw/environment-smoothing";
import { MusicControlPlanner, type ControlPlan } from "@/lib/sw/music-control";
import { RealStepSession } from "@/lib/sw/real-step-session";
import {buildSafeDiagnosticsReport,copySafeDiagnosticsReport} from "@/lib/sw/safe-diagnostics-report";
import { YamnetObservationLog, type YamnetObservation } from "@/lib/sw/yamnet-observation-log";
import { useSettings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { buildMusicRequest } from "@/lib/sw/music-preferences";
import { currentAudioSinkStatus } from "@/lib/sw/native-pcm";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";

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
  const [pending,setPending] = useState(false);
  const pendingRef = useRef(false);
  const [steps,setSteps] = useState("Нет подтверждённых шагов");
  const [stepCount,setStepCount] = useState<number|null>(null);
  const countingSteps = useRef(false);
  const [stepsOnly,setStepsOnly]=useState(false);
  const collectingSound=useRef(false);
  const soundLog=useRef(new YamnetObservationLog());
  const [soundEvents,setSoundEvents]=useState<readonly YamnetObservation[]>([]);
  const stepCounter = useRef(new RealStepSession());
  const lastRealStep = useRef(0);
  const [error,setError] = useState("");
  const [reportMessage,setReportMessage] = useState("");
  const [environment,setEnvironment] = useState("Обстановка не определена");
  const [micInput,setMicInput] = useState("");
  const [micRms,setMicRms] = useState<number | null>(null);
  const [output,setOutput] = useState<Awaited<ReturnType<typeof currentAudioSinkStatus>>>(null);
  const [wavOutput,setWavOutput] = useState<Awaited<ReturnType<typeof currentStoredPlayback>>>(null);
  const [hardware,setHardware] = useState<{ramMb?:number;battery?:number;thermalStatus?:number;inferenceSkipped:number;inferenceThrottled?:number;analysisStride?:number;batteryMode?:string;lowMemory?:boolean;captureRateHz?:number}|null>(null);
  useEffect(()=>{
    const estimator = new StepPaceEstimator();
    const stabilizer = new AmbientStabilizer();
    const planner = new MusicControlPlanner();
    const updatePlan = () => setPlan(planner.plan(settingsRef.current,Date.now()));
    let mounted=true;
    void sensorStatus().then(s=>{if(mounted)setStatus(s)});
    void getNativePerformanceSnapshot().then(s=>{if(mounted)setHardware(s)});
    void currentAudioSinkStatus().then(s=>{if(mounted)setOutput(s)});
    void currentStoredPlayback().then(s=>{if(mounted)setWavOutput(s)});
    const removeSteps=observeRawSteps(e=>{
      if (!countingSteps.current) return;
      const accepted=stepCounter.current.ingest(e,Date.now());
      if (!accepted) return; // no fake increments from duplicated/old callbacks
      setStepCount(accepted.count);
      lastRealStep.current=accepted.lastStepAt;
      const pace=estimator.ingest(e.timestamp);
      if (pace.activity!=="unknown"){
        setSteps((pace.activity==="running"?"Бег":"Ходьба")+" · "+pace.bpm+" шагов/мин");
        planner.observePace({bpm:pace.bpm,confidence:pace.confidence,timestamp:e.timestamp});
        updatePlan();
      } else {
        setSteps("Шаги обнаружены · ритм определяется");
      }
    });
    const removeErrors=observeSensorErrors(setError);
    const removeSounds=observeRawSound(e=>{
      if (!collectingSound.current || settingsRef.current.musicOnlyMode) return;
      const received=soundLog.current.ingest(e,Date.now());
      if (received!==null) setSoundEvents(received);
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
      void currentAudioSinkStatus().then(x=>{if(mounted)setOutput(x)});
      void currentStoredPlayback().then(x=>{if(mounted)setWavOutput(x)});
      // Lack of fresh steps is "unknown", not proof that the user is resting.
      if (countingSteps.current && lastRealStep.current > 0 &&
          Date.now()-lastRealStep.current>5000)
        setSteps("Нет свежих шагов · активность не определена");
      updatePlan();
    },3000);
    return ()=>{mounted=false;countingSteps.current=false;stepCounter.current.stop();
      collectingSound.current=false;soundLog.current.stop();
      clearInterval(interval);removeSteps();removeErrors();removeSounds();removeMic();void stopSensorDiagnostics()};
  },[]);
  const start=async(mode:"all"|"steps"="all")=>{
    if(pendingRef.current || settingsRef.current.musicOnlyMode) return;
    pendingRef.current=true;setPending(true);
    try {
      const result=mode==="steps"?await startStepOnlyDiagnostics():await startSensorDiagnostics(true);
      if(!result.ok) {notify.result(result,"");setError(result.message);}
      else {
        stepCounter.current.start(Date.now());
        countingSteps.current=true;
        lastRealStep.current=0;
        setStepCount(0);
        setSteps("Ожидание настоящих шагов Android");
        const soundEnabled=mode==="all";
        collectingSound.current=soundEnabled;
        soundLog.current.stop();
        if(soundEnabled)soundLog.current.start(Date.now());
        setSoundEvents([]);
        setStepsOnly(mode==="steps");
        setActive(true);setError("");setEnvironment(soundEnabled?"Ожидание достоверного результата":"Анализ не запущен: только шаги");
      }
      setStatus(await sensorStatus());
      setHardware(await getNativePerformanceSnapshot());
    } finally {pendingRef.current=false;setPending(false);}
  };
  const copyReport=async()=>{
    const report=buildSafeDiagnosticsReport({
      android:androidSensorsAvailable(),musicOnly:settings.musicOnlyMode,
      active,stepsOnly,stepCount,sensors:status,performance:hardware,
      pcm:output,wav:wavOutput,
    });
    const copied=await copySafeDiagnosticsReport(report);
    setReportMessage(copied
      ?"Диагностический отчёт скопирован. Аудио и личные данные не включены."
      :"Не удалось скопировать отчёт: буфер обмена недоступен.");
  };
  const stop=async()=>{
    if(pendingRef.current) return;
    pendingRef.current=true;setPending(true);
    countingSteps.current=false;
    stepCounter.current.stop();
    collectingSound.current=false;
    soundLog.current.stop();
    setSoundEvents([]);
    try {
      await stopSensorDiagnostics();setActive(false);setMicRms(null);setPlan(null);
      setSteps("Проверка остановлена");
      setStatus(await sensorStatus());setHardware(await getNativePerformanceSnapshot());
    } finally {pendingRef.current=false;setPending(false);}
  };
  return (
    <>
      <PageHeader title="Диагностика" back subtitle="Проверка настоящих датчиков Android" />
      <div className="space-y-4 px-4 py-4">
        <Section>
          <div className="space-y-3 p-4 text-sm">
            <p>Платформа: {androidSensorsAvailable()?"Android":"Веб-версия (датчики недоступны)"}</p>
            <p>YAMNet: {status?.yamnetIncluded?"Модель найдена":"Модель не подключена"}</p>
            <p>Fermata (музыкальная нейросеть): не подключена</p>
            <p>Микрофон: {status?.microphoneGranted?"Разрешение есть":"Разрешение не получено"}</p>
            <p>Источник микрофона: {active?(micInput||status?.actualInput||"Определяется"):"Не используется"}</p>
            <p>Фактическая частота микрофона: {active?((hardware?.captureRateHz||status?.captureRateHz)?(hardware?.captureRateHz||status?.captureRateHz)+" Гц":"Определяется"):"Микрофон выключен"}{active && (hardware?.captureRateHz||status?.captureRateHz)===48000?" (YAMNet получает 16 кГц после фильтрации)":""}</p>
            <p>Живой уровень микрофона: {active&&micRms!==null?Math.round(micRms*1000)/10+"%":"Нет сигнала"}</p>
            <p>Датчик шагов: {status?.stepsSupported?"Найден":"Нет данных / отсутствует"}</p>
            <p>Активность: {steps}</p>
            <p aria-live="polite">Шаги за {active?"текущую":"последнюю"} проверку: {stepCount===null?"Проверка не запускалась":stepCount}</p>
            <p>Доступная оперативная память: {hardware?.ramMb === undefined?"Нет данных":hardware.ramMb+" МБ"}</p>
            <p>Заряд батареи: {hardware?.battery === undefined?"Нет данных":hardware.battery+"%"}</p>
            <p>Тепловой статус Android: {hardware?.thermalStatus === undefined?"Нет данных":hardware.thermalStatus}</p>
            <p>Пропущенные окна из-за занятости YAMNet: {hardware?.inferenceSkipped ?? "Нет данных"}</p>
            <p>Окна экономии заряда/нагрева: {hardware?.inferenceThrottled ?? "Нет данных"}</p>
            <p>Анализ окружения: {hardware?.analysisStride===1?"Каждое окно":hardware?.analysisStride?`Каждое ${hardware.analysisStride}-е окно`:"Нет данных"}</p>
            <p>Фоновая аудиослужба PCM: {output?.serviceActive?"Работает":"Не запущена"}</p>
            <p>Готовность реального PCM-потока: {output?.readyForPcm?"Android готов принять звук":"Не готов / генератор не запущен"}</p>
            <p>Сохранённый WAV: {wavOutput?.state==="playing"?"Играет":wavOutput?.state==="paused"?"Пауза":wavOutput?.state==="preparing"?"Подготовка":"Не воспроизводится"}</p>
            <p>Фактический аудиовыход WAV: {wavOutput?.actualOutput || "Не определён / WAV не запущен"}</p>
            <p>Тип выхода Android: {wavOutput?.actualOutputType || "Нет данных"}</p>
            {wavOutput?.lastError && <p role="alert" className="text-destructive">Ошибка WAV: {wavOutput.lastError}</p>}
            <p>Буфер звука: {output?.serviceActive?output.queuedChunks+" фрагментов":"Не используется"}</p>
            <p>Пропуски AudioTrack: {output?.underruns !== undefined && output.underruns >= 0?output.underruns:"Не измерены"}</p>
            {output?.lastAudioError&&<p role="alert" className="text-destructive">Последняя ошибка звука: {output.lastAudioError}</p>}
            <p>Обстановка: {stepsOnly?"Не анализируется: только шаги":status?.yamnetIncluded ? environment : ATMOSPHERE_RU.unknown}</p>
            <div className="space-y-1" aria-label="Последние распознанные звуки YAMNet">
              <p className="font-medium">Распознанные звуки YAMNet за текущую проверку</p>
              {!soundEvents.length && <p className="text-xs text-muted-foreground">Нет подтверждённых событий за текущую проверку</p>}
              {soundEvents.map((e,i)=><p className="text-xs text-muted-foreground" key={e.timestamp+"-"+e.label+"-"+i}>
                {e.label} · {Math.round(e.confidence*100)}% · {e.source}
              </p>)}
              <p className="text-xs text-muted-foreground">Только локальные названия классов звука. Сам звук и разговоры не сохраняются.</p>
            </div>
            <p>Запрошенный темп будущей музыки: {plan?.tempoBpm ?? "Нет плана"} BPM</p>
            <p>Ритм шагов для отдельной перкуссии: {plan?.stepPulseBpm ?? "Не определён"}</p>
            <p>План смены атмосферы: {plan?.transitionMs ?? "Не определён"} мс</p>
            <p>Разрешённых музыкальных направлений: {request?.genreCandidates.length ?? "Нет плана"}</p>
            <p>Исключённых инструментов: {request?.excludedInstruments.length ?? "Нет плана"}</p>
            <p>Вокал: запрещён для будущей генерации</p>
            <p>Разнообразие: {request?.diversity??"Нет плана"}</p>
            <p>Интенсивность акцентов шагов: {request?.stepAccentStrength??"Нет плана"}</p>
            <p>Использование обработанных звуков: {request?.allowProcessedAmbientAudio?"Запрошено, но не реализовано":"Нет"}</p>
            <p className="text-xs text-muted-foreground">Это только план управления будущей генерацией, не воспроизводимый звук.</p>
            {error&&<p role="alert" className="text-destructive">{error}</p>}
          </div>
        </Section>
        <div className="flex flex-wrap gap-3">
          <button className="min-h-12 rounded-xl bg-primary px-5 text-primary-foreground disabled:opacity-50"
            disabled={!androidSensorsAvailable()||active||pending||settings.musicOnlyMode} onClick={()=>void start("all")}>
            Проверить микрофон и шаги
          </button>
          <button className="min-h-12 rounded-xl border border-border px-5 disabled:opacity-50"
            disabled={!androidSensorsAvailable()||active||pending||settings.musicOnlyMode} onClick={()=>void start("steps")}>
            Проверить только шаги
          </button>
          <button className="min-h-12 rounded-xl border border-border px-5 disabled:opacity-50"
            disabled={!active||pending} onClick={()=>void stop()}>
            Остановить проверку
          </button>
        </div>
        <div className="space-y-1">
          <button className="min-h-12 rounded-xl border border-border px-5 text-sm"
            onClick={()=>void copyReport()}>Скопировать диагностический отчёт</button>
          {reportMessage&&<p role="status" className="text-xs text-muted-foreground">{reportMessage}</p>}
          <p className="text-xs text-muted-foreground">
            Только показатели системы и функции. Без звука, файлов, имён устройств и геолокации.
          </p>
        </div>
        {settings.musicOnlyMode && <p className="text-xs text-warning" role="status">Включён режим «Без анализа окружения». Выключите его в Настройках, чтобы проверить микрофон и шаги.</p>}
        <p className="text-xs text-muted-foreground">
          Проверка «только шаги» использует разрешение на активность и датчик шагов, микрофон при этом не включается.
          Проверка запускается только по нажатию и выключается при уходе с экрана.
          Разговоры не сохраняются. При наличии YAMNet кнопка запускает настоящее локальное распознавание звуков. Музыкальная генерация пока недоступна.
        </p>
      </div>
    </>
  );
}
