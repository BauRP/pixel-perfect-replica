/**
 * Capacitor bridge to actual Android YAMNet and motion sensors.
 * Does not install a music engine. Never synthesizes audio or fake detections.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  registerAdapters, type Adapters, type EnvironmentEvent, type Result, type Unsubscribe,
} from "./engine";
import { AmbientStabilizer, StepPaceEstimator, type Atmosphere } from "./environment-smoothing";
import { getSettingsSnapshot, type Settings } from "./settings";
import { sensorsAllowed, SENSOR_MODE_BLOCKED } from "./sensor-mode";
import { manageNativeListener } from "./native-listener";

type NativeResult = { started?: boolean; stopped?: boolean; granted?: boolean; active?: boolean; name?: string; kind?: string; input?: string; output?: string };
export interface SensorsStatus {
  yamnetIncluded: boolean;
  microphoneGranted: boolean;
  activityGranted: boolean;
  stepsSupported: boolean;
  recording: boolean;
  actualInput: string;
  preferredInput?: "auto" | "headset" | "phone";
  actualInputCategory?: "headset" | "phone" | "unknown";
  captureRateHz?: number;
}
export interface RawSound {
  label: string;
  confidence: number;
  timestamp: number;
  source: "headsetMic" | "phoneMic" | "bluetoothMic";
}
export interface RawStep { timestamp: number; sensor: string }
interface SensorsPlugin {
  status(): Promise<SensorsStatus>;
  requestMicrophone(): Promise<{ granted: boolean }>;
  requestActivity(): Promise<{ granted: boolean }>;
  setInputPreference(options:{preference:"auto"|"headset"|"phone"}): Promise<{selected:string}>;
  startAnalysis(): Promise<NativeResult>;
  setBatteryMode(options:{mode:Settings["batteryMode"]}): Promise<{configured:boolean;mode:string}>;
  startMicrophoneProbe(): Promise<NativeResult>;
  stopMicrophoneProbe(): Promise<NativeResult>;
  stopAnalysis(): Promise<NativeResult>;
  startSteps(): Promise<NativeResult>;
  stopSteps(): Promise<NativeResult>;
  actualMicrophone(): Promise<{ name: string; kind: string; active: boolean; output: string }>;
  performanceSnapshot(): Promise<{ramMb?:number;battery?:number;elapsedSec:number;thermalStatus?:number;lowMemory?:boolean;inferenceSkipped:number;inferenceThrottled:number;analysisStride:number;analysisActive:boolean;captureRateHz:number;batteryMode:string;recording:boolean}>;
  addListener(event: "yamnet" | "step" | "analysisError" | "micLevel" | "audioRouteChanged", callback: (value: any) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<SensorsPlugin>("SoundWorldSensors");

/** Disabling automatic routing means no automatic headset preference. */
export function effectiveMicrophonePreference(
  s: Pick<Settings,"autoAudioRouting"|"microphonePreference">,
): Settings["microphonePreference"] {
  return !s.autoAudioRouting && s.microphonePreference==="auto" ? "phone" : s.microphonePreference;
}
export const androidSensorsAvailable = () => Capacitor.getPlatform() === "android";
const unavailable = (message: string): {ok:false;code:"UNAVAILABLE";message:string} => ({ ok: false, code: "UNAVAILABLE", message });
const safeError = (e: unknown): {ok:false;code:"ERROR";message:string} => ({
  ok: false,
  code: "ERROR",
  message: e instanceof Error ? e.message : "Ошибка модуля Android",
});
export async function getNativePerformanceSnapshot() {
  if (!androidSensorsAvailable()) return null;
  try { return await native.performanceSnapshot(); } catch { return null; }
}
export async function sensorStatus(): Promise<SensorsStatus | null> {
  if (!androidSensorsAvailable()) return null;
  try { return await native.status(); } catch { return null; }
}
let diagnosticEpoch = 0;
export async function startSensorDiagnostics(includeSteps: boolean): Promise<Result> {
  if (!androidSensorsAvailable()) return unavailable("Только в Android APK");
  if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
  const epoch = ++diagnosticEpoch;
  const cancelled = () => epoch !== diagnosticEpoch;
  let started=false;
  try {
    const permission = await native.requestMicrophone();
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!permission.granted) return {ok:false,code:"PERMISSION_DENIED",message:"Микрофон не разрешён"};
    const availability = await native.status();
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    // Request all permissions BEFORE starting audio: Android may pause the
    // Activity while showing a permission dialog, which stops diagnostic capture.
    if (includeSteps && availability.stepsSupported) {
      try {
        const activity = await native.requestActivity();
        if(cancelled()) return unavailable("Проверка микрофона отменена");
        if (activity.granted) await native.startSteps();
      } catch { /* microphone still works without the motion sensor */ }
    }
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    await native.setInputPreference({preference:effectiveMicrophonePreference(getSettingsSnapshot())});
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) {
      await native.stopSteps().catch(()=>{});
      return unavailable(SENSOR_MODE_BLOCKED);
    }
    const r = availability.yamnetIncluded
      ? await native.startAnalysis()
      : await native.startMicrophoneProbe();
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) {
      await Promise.allSettled([native.stopMicrophoneProbe(),native.stopSteps()]);
      return unavailable(SENSOR_MODE_BLOCKED);
    }
    if (!r.started) {
      await native.stopSteps().catch(()=>{});
      return unavailable("Проверка микрофона не запущена");
    }
    started=true;
    return {ok:true,value:undefined};
  } catch(e) {
    // A late failure from a cancelled run must never stop a newer recording.
    if(!cancelled()) {
      await native.stopSteps().catch(()=>{});
      if(started)await stopSensorDiagnostics();
    }
    return safeError(e);
  }
}
/** Independent step-detector test. It must never ask for microphone permission,
 * initialize AudioRecord, or create YAMNet inference resources. */
export async function startStepOnlyDiagnostics(): Promise<Result> {
  if (!androidSensorsAvailable()) return unavailable("Шагомер доступен только в Android APK");
  if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
  const epoch = ++diagnosticEpoch;
  const cancelled = () => epoch !== diagnosticEpoch;
  try {
    const status = await native.status();
    if (cancelled()) return unavailable("Запуск шагомера отменён");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!status.stepsSupported) return unavailable("На устройстве отсутствует датчик шагов");
    const permission = await native.requestActivity();
    if (cancelled()) return unavailable("Запуск шагомера отменён");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!permission.granted)
      return {ok:false,code:"PERMISSION_DENIED",message:"Разрешите физическую активность для шагомера"};
    const result = await native.startSteps();
    if (cancelled() || !sensorsAllowed(getSettingsSnapshot())) {
      await native.stopSteps().catch(()=>{});
      return unavailable("Запуск шагомера отменён");
    }
    return result.started
      ? {ok:true,value:undefined}
      : unavailable("Android не подтвердил запуск датчика шагов");
  } catch (e) {
    return safeError(e);
  }
}

export async function stopSensorDiagnostics(): Promise<void> {
  ++diagnosticEpoch; // invalidate suspended permission dialogs / native starts
  if (!androidSensorsAvailable()) return;
  await Promise.allSettled([native.stopMicrophoneProbe(),native.stopSteps()]);
}
function subscribe<T>(event: "yamnet"|"step"|"analysisError"|"micLevel"|"audioRouteChanged", cb: (data:T)=>void):Unsubscribe {
  if (!androidSensorsAvailable()) return () => {};
  let closed = false;
  const unsubscribe = manageNativeListener(() => native.addListener(event, data=>{if(!closed) cb(data as T);}));
  return () => {closed=true;unsubscribe();};
}
export function observeRawSound(cb:(sound:RawSound)=>void):Unsubscribe { return subscribe("yamnet",cb); }
export function observeMicrophoneLevel(cb:(level:{rms:number;timestamp:number;input:string})=>void):Unsubscribe {return subscribe("micLevel",cb);}
export function observeRawSteps(cb:(step:RawStep)=>void):Unsubscribe { return subscribe("step",cb); }
export function observeActualRouteChanges(cb:()=>void):Unsubscribe { return subscribe("audioRouteChanged",()=>cb()); }
export function observeSensorErrors(cb:(message:string)=>void):Unsubscribe {
  return subscribe<{message:string}>("analysisError",e=>cb(e.message));
}

/** Use real native data only. No microphone/sensor capture before an explicit Play/test action. */
export function installNativeSensorAdapters(): void {
  if (!androidSensorsAvailable()) return;
  const stability = new AmbientStabilizer();
  const pace = new StepPaceEstimator();
  let lastConfirmedMicSource: RawSound["source"] | null = null;
  const adapters: Partial<Adapters> = {
    permissions: {
      microphone: async () => {
        const s=await sensorStatus();
        return s?{ok:true,value:s.microphoneGranted?"granted" as const:"prompt" as const}:unavailable("Нет данных о разрешении");
      },
      requestMicrophone: async () => {
        if(!sensorsAllowed(getSettingsSnapshot()))return unavailable(SENSOR_MODE_BLOCKED);
        try {
          const r=await native.requestMicrophone();
          if(!sensorsAllowed(getSettingsSnapshot()))return unavailable(SENSOR_MODE_BLOCKED);
          return {ok:true,value:r.granted?"granted" as const:"denied" as const};
        }
        catch(e){return safeError(e);}
      }
    },
    environment: {
      checkAvailability: async () => {
        const s=await sensorStatus();
        return s?.yamnetIncluded?{ok:true,value:undefined}:unavailable("Файл YAMNet отсутствует");
      },
      startCapture: async () => {
        if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
        try {
          const s=await native.status();
          if(!s.microphoneGranted) return {ok:false,code:"PERMISSION_DENIED",message:"Разрешите микрофон при запуске музыки"};
          if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
          await native.setInputPreference({preference:effectiveMicrophonePreference(getSettingsSnapshot())});
          if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
          const r = await native.startAnalysis();
          if (!sensorsAllowed(getSettingsSnapshot())) {
            await native.stopAnalysis().catch(()=>{});
            return unavailable(SENSOR_MODE_BLOCKED);
          }
          return r.started ? {ok:true,value:undefined} : unavailable("Модель YAMNet недоступна");
        }catch(e){return safeError(e);}
      },
      stopCapture: async () => {
        try {await native.stopAnalysis();stability.reset();lastConfirmedMicSource=null;return {ok:true,value:undefined};}
        catch(e){return safeError(e);}
      },
      observeEnvironment: cb => observeRawSound(e=>{
        if (!sensorsAllowed(getSettingsSnapshot())) return;
        // Different physical source types need independent YAMNet evidence.
        if (lastConfirmedMicSource !== null && lastConfirmedMicSource !== e.source)
          stability.reset();
        lastConfirmedMicSource = e.source;
        const stable=stability.update(e);
        if (!stable) return;
        const mapped:EnvironmentEvent={label:stable.atmosphere,confidence:stable.confidence,timestamp:stable.timestamp,source:e.source};
        cb(mapped);
      }),
    },
    activity: {
      observeWalkingRunningTransportRest: cb => observeRawSteps(e=>{
        if (!sensorsAllowed(getSettingsSnapshot())) return;
        const rate=pace.ingest(e.timestamp);
        if(rate.activity!=="unknown")cb({activity:rate.activity,confidence:rate.confidence});
      }),
    },
    performance: {
      snapshot: async () => {
        try {const r=await native.performanceSnapshot();return {ok:true,value:{...(r.ramMb === undefined?{}:{ramMb:r.ramMb}),...(r.battery===undefined?{}:{battery:r.battery}),elapsedSec:r.elapsedSec}};}
        catch(e){return safeError(e);}
      },
      applyBatteryMode:async(mode)=>{
        try{
          const configured=await native.setBatteryMode({mode});
          return configured.configured?{ok:true,value:undefined}:unavailable("Режим нагрузки не подтверждён Android");
        }catch(e){return safeError(e);}
      },
    },
    router: {
      currentActualMicrophone:async()=>{
        try {const r=await native.actualMicrophone();return r.active?{ok:true,value:{name:r.name,kind:r.kind}}:unavailable("Микрофон сейчас не используется");}
        catch(e){return safeError(e);}
      },
      verifyActualRoute:async()=>{
        try {const r=await native.actualMicrophone();return r.active?{ok:true,value:{input:r.name,output:r.output}}:unavailable("Маршрут не подтверждён: запись не запущена");}
        catch(e){return safeError(e);}
      },
      chooseBestSupportedRoute:async()=>{
        try { await native.setInputPreference({preference:effectiveMicrophonePreference(getSettingsSnapshot())});return {ok:true,value:undefined}; }
        catch(e){return safeError(e);}
      },
      observeInputOutputChanges:cb=>observeActualRouteChanges(cb),
    }
  };
  registerAdapters(adapters);
}
export const ATMOSPHERE_RU: Record<Atmosphere,string> = {
  rain:"Дождь", traffic:"Транспорт", nature:"Природа", indoor:"Помещение", quiet:"Тишина", unknown:"Обстановка не определена"
};
