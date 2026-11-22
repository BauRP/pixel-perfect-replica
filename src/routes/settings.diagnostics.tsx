import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader, Section } from "@/components/sw/ui";
import {
  androidSensorsAvailable, observeRawSteps, observeSensorErrors, observeRawSound, observeMicrophoneLevel, sensorStatus,
  startSensorDiagnostics, startStepOnlyDiagnostics, stopSensorDiagnostics, getNativePerformanceSnapshot, ATMOSPHERE_RU,
  type SensorsStatus, observeActualRouteChanges
} from "@/lib/sw/native-sensors";
import { AmbientStabilizer, StepPaceEstimator } from "@/lib/sw/environment-smoothing";
import { MusicControlPlanner, type ControlPlan } from "@/lib/sw/music-control";
import { RealStepSession } from "@/lib/sw/real-step-session";
import {BirdEvidenceGate} from "@/lib/sw/director-live-preview";
import {buildSafeDiagnosticsReport,copySafeDiagnosticsReport} from "@/lib/sw/safe-diagnostics-report";
import { YamnetObservationLog, type YamnetObservation } from "@/lib/sw/yamnet-observation-log";
import { useSettings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { buildMusicRequest } from "@/lib/sw/music-preferences";
import { currentAudioSinkStatus } from "@/lib/sw/native-pcm";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { resetDiagnosticEvidence } from "@/lib/sw/diagnostic-evidence";
import { SoundRouteFence } from "@/lib/sw/sound-route-fence";

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => ({ meta: [{ title: "Диагностика — SoundWorld AR" }, { name: "description", content: "Проверка настоящих датчиков и аудиовыхода SoundWorld AR." }, { property: "og:title", content: "Диагностика — SoundWorld AR" }, { property: "og:description", content: "Проверка настоящих датчиков и аудиовыхода SoundWorld AR." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
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
  const routeFence=useRef(new SoundRouteFence());
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
  const resetEvidence = useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(!settings.musicOnlyMode)return;
    // AppShell stops native mic/steps for the whole app. Also invalidate the
    // local diagnostic presentation immediately rather than showing old
    // observations as if analysis were still permitted.
    countingSteps.current=false;
    collectingSound.current=false;
    stepCounter.current.stop();
    soundLog.current.stop();
    routeFence.current.reset();
    resetEvidence.current();
    setActive(false);
    setStepsOnly(false);
    setSteps("Без анализа окружения");
    setStepCount(null);
    setSoundEvents([]);
    setEnvironment("Обстановка не определяется");
    setMicInput("");
    setMicRms(null);
    setPlan(null);
  },[settings.musicOnlyMode]);
  useEffect(()=>{
    const estimator = new StepPaceEstimator();
    const stabilizer = new AmbientStabilizer();
    const planner = new MusicControlPlanner();
    const birds=new BirdEvidenceGate();
    resetEvidence.current=()=>resetDiagnosticEvidence({estimator,stabilizer,planner,birds});
    const updatePlan = () => {
      if (!countingSteps.current && !collectingSound.current) {setPlan(null);return;}
      setPlan(planner.plan(settingsRef.current,Date.now()));
    };
    let mounted=true, readingSnapshots=false;
    // Serial Android polling prevents slow bridge calls from piling up every 3s.
    const refreshSnapshots=async()=>{
      if(!mounted || readingSnapshots)return;
      readingSnapshots=true;
      try {
        const [hardwareResult,outputResult,wavResult]=await Promise.allSettled([
          getNativePerformanceSnapshot(),currentAudioSinkStatus(),currentStoredPlayback(),
        ]);
        if(!mounted)return;
        if(hardwareResult.status==="fulfilled")setHardware(hardwareResult.value);
        if(outputResult.status==="fulfilled")setOutput(outputResult.value);
        if(wavResult.status==="fulfilled")setWavOutput(wavResult.value);
      }finally{readingSnapshots=false;}
    };
    void sensorStatus().then(s=>{if(mounted)setStatus(s)});
    void refreshSnapshots();
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
    const removeErrors=observeSensorErrors(message=>{
      if(countingSteps.current || collectingSound.current)setError(message);
    });
    const removeSounds=observeRawSound(e=>{
      if (!collectingSound.current || settingsRef.current.musicOnlyMode) return;
      const route=routeFence.current.observe(e);
      if(route==="stale")return;
      if(route==="changed") {
        // The last sound/musical direction belonged to another microphone.
        resetEvidence.current();
        soundLog.current.start(Date.now());
        setSoundEvents([]);
        setEnvironment("Новый микрофон · ожидание подтверждения окружения");
        setPlan(null);
      }
      const received=soundLog.current.ingest(e,Date.now());
      if (received!==null) setSoundEvents(received);
      const birdConfirmed=birds.ingest(e.label,e.confidence,e.timestamp);
      const stable=stabilizer.update(e);
      if(stable) {
        setEnvironment(stable.atmosphere+" · "+Math.round(stable.confidence*100)+"%");
        planner.observeAmbient(stable,settingsRef.current);
      }
      if(birdConfirmed)planner.observeConfirmedBird(e.timestamp);
      if(stable||birdConfirmed)updatePlan();
    });
    const removeRoute=observeActualRouteChanges(()=>{
      if(!collectingSound.current)return;
      // On a hot-plug, revoke old evidence immediately; do not wait for
      // the next (possibly delayed) classifier result to change UI.
      routeFence.current.reset();
      resetEvidence.current();
      soundLog.current.start(Date.now());
      setSoundEvents([]);
      setEnvironment("Маршрут изменён · ожидание нового распознавания");
      setPlan(null);
    });
    const removeMic=observeMicrophoneLevel(e=>{
      if(!collectingSound.current || settingsRef.current.musicOnlyMode)return;
      setMicInput(e.input);setMicRms(e.rms);
    });
    const interval=setInterval(()=>{
      if (!mounted) return;
      void refreshSnapshots();
      // Lack of fresh steps is "unknown", not proof that the user is resting.
      if (countingSteps.current && lastRealStep.current > 0 &&
          Date.now()-lastRealStep.current>5000)
        setSteps("Нет свежих шагов · активность не определена");
      updatePlan();
    },3000);
    return ()=>{mounted=false;countingSteps.current=false;stepCounter.current.stop();
      collectingSound.current=false;soundLog.current.stop();resetEvidence.current();resetEvidence.current=()=>{};
      routeFence.current.reset();
      clearInterval(interval);removeSteps();removeErrors();removeSounds();removeMic();removeRoute();void stopSensorDiagnostics()};
  },[]);
  const start=async(mode:"all"|"steps"="all")=>{
    if(pendingRef.current || settingsRef.current.musicOnlyMode) return;
    pendingRef.current=true;setPending(true);
    try {
      const result=mode==="steps"?await startStepOnlyDiagnostics():await startSensorDiagnostics(true);
      if(!result.ok) {notify.result(result,"");setError(result.message);}
      else {
        // Every explicitly started test begins with fresh evidence only.
        resetEvidence.current();routeFence.current.reset();setPlan(null);setMicInput("");setMicRms(null);
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
    resetEvidence.current();routeFence.current.reset();
    setSoundEvents([]);
    try {
      await stopSensorDiagnostics();setActive(false);setMicRms(null);setMicInput("");setPlan(null);
      setEnvironment("Обстановка не определена");
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
