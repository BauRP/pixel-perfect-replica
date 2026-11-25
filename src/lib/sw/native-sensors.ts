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
import { SoundRouteFence } from "./sound-route-fence";
import { SerialNativeOperations } from "./serial-native-operations";
import { withNativeDeadline } from "./native-call-deadline";

type NativeResult = { started?: boolean; stopped?: boolean; granted?: boolean; active?: boolean; name?: string; kind?: string; input?: string; output?: string };
export interface SensorsStatus {
  yamnetIncluded: boolean;
  microphoneGranted: boolean;
  activityGranted: boolean;
  stepsSupported: boolean;
  stepsActive?: boolean;
  recording: boolean;
  actualInput: string;
  preferredInput?: "auto" | "headset" | "phone";
  actualInputCategory?: "headset" | "phone" | "unknown";
  captureRateHz?: number;
  analysisStride?: number;
}
export interface RawSound {
  label: string;
  confidence: number;
  timestamp: number;
  source: "headsetMic" | "phoneMic" | "bluetoothMic";
  routeGeneration?: number;
}
export interface RawStep { timestamp: number; sensor: string; discontinuity?:boolean }
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
  actualMicrophone(): Promise<{ name: string; kind: string; active: boolean; output: string; routeConfirmed?:boolean }>;
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
  try { return await withNativeDeadline(()=>native.performanceSnapshot(),4000); } catch { return null; }
}
export async function sensorStatus(): Promise<SensorsStatus | null> {
  if (!androidSensorsAvailable()) return null;
  try { return await withNativeDeadline(()=>native.status(),4000); } catch { return null; }
}
let diagnosticEpoch = 0;
// A stop request invalidates pending start immediately, then runs AFTER any
// in-flight native start. Without serialization a delayed startAnalysis() can
// reopen Android AudioRecord AFTER the user's privacy opt-out.
const diagnosticOperations = new SerialNativeOperations();
const stopNativeDiagnostics = async () => {
  // One rejected/never-resolved Capacitor callback must not poison the
  // lifecycle queue. Timed-out STOP is unknown, not proof of microphone off.
  await Promise.allSettled([
    withNativeDeadline(()=>native.stopMicrophoneProbe(),5000),
    withNativeDeadline(()=>native.stopSteps(),5000),
  ]);
};
export function startSensorDiagnostics(includeSteps: boolean): Promise<Result> {
  if (!androidSensorsAvailable()) return Promise.resolve(unavailable("Только в Android APK"));
  if (!sensorsAllowed(getSettingsSnapshot())) return Promise.resolve(unavailable(SENSOR_MODE_BLOCKED));
  const epoch = ++diagnosticEpoch;
  return diagnosticOperations.enqueue(async ():Promise<Result> => {
    const cancelled = () => epoch !== diagnosticEpoch;
    if (cancelled() || !sensorsAllowed(getSettingsSnapshot()))
      return unavailable("Запуск анализа отменён");
    try {
    const permission = await withNativeDeadline(()=>native.requestMicrophone(),60_000);
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!permission.granted) return {ok:false,code:"PERMISSION_DENIED",message:"Микрофон не разрешён"};
    const availability = await withNativeDeadline(()=>native.status(),5000);
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    // Request all permissions BEFORE starting audio: Android may pause the
    // Activity while showing a permission dialog, which stops diagnostic capture.
    if (includeSteps && availability.stepsSupported) {
      try {
        const activity = await withNativeDeadline(()=>native.requestActivity(),60_000);
        if(cancelled()) return unavailable("Проверка микрофона отменена");
        if (activity.granted) await withNativeDeadline(()=>native.startSteps(),8000);
      } catch { /* microphone still works without the motion sensor */ }
    }
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    await withNativeDeadline(()=>native.setInputPreference({preference:effectiveMicrophonePreference(getSettingsSnapshot())}),6000);
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) {
      await withNativeDeadline(()=>native.stopSteps(),5000).catch(()=>{});
      return unavailable(SENSOR_MODE_BLOCKED);
    }
    const r = availability.yamnetIncluded
      ? await withNativeDeadline(()=>native.startAnalysis(),12_000)
      : await withNativeDeadline(()=>native.startMicrophoneProbe(),12_000);
    if(cancelled()) return unavailable("Проверка микрофона отменена");
    if (!sensorsAllowed(getSettingsSnapshot())) {
      await stopNativeDiagnostics();
      return unavailable(SENSOR_MODE_BLOCKED);
    }
    if (!r.started) {
      await withNativeDeadline(()=>native.stopSteps(),5000).catch(()=>{});
      return unavailable("Проверка микрофона не запущена");
    }
    return {ok:true,value:undefined};
    } catch(e) {
      // Serialization guarantees no newer diagnostic has started while the
      // failed operation still owns native capture. Clean both resources.
      await stopNativeDiagnostics();
      return safeError(e);
    } finally {
      // Covers a delayed native start resolving AFTER opt-out or a stop tap.
      // The queued stop will also run before any newer start is permitted.
      if (cancelled() || !sensorsAllowed(getSettingsSnapshot()))
        await stopNativeDiagnostics();
    }
  });
}
/** Independent step-detector test. It must never ask for microphone permission,
 * initialize AudioRecord, or create YAMNet inference resources. */
export function startStepOnlyDiagnostics(): Promise<Result> {
  if (!androidSensorsAvailable()) return Promise.resolve(unavailable("Шагомер доступен только в Android APK"));
  if (!sensorsAllowed(getSettingsSnapshot())) return Promise.resolve(unavailable(SENSOR_MODE_BLOCKED));
  const epoch = ++diagnosticEpoch;
  return diagnosticOperations.enqueue(async ():Promise<Result> => {
    const cancelled = () => epoch !== diagnosticEpoch;
    if (cancelled() || !sensorsAllowed(getSettingsSnapshot()))
      return unavailable("Запуск шагомера отменён");
    try {
    const status = await withNativeDeadline(()=>native.status(),5000);
    if (cancelled()) return unavailable("Запуск шагомера отменён");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!status.stepsSupported) return unavailable("На устройстве отсутствует датчик шагов");
    const permission = await withNativeDeadline(()=>native.requestActivity(),60_000);
    if (cancelled()) return unavailable("Запуск шагомера отменён");
    if (!sensorsAllowed(getSettingsSnapshot())) return unavailable(SENSOR_MODE_BLOCKED);
    if (!permission.granted)
      return {ok:false,code:"PERMISSION_DENIED",message:"Разрешите физическую активность для шагомера"};
    const result = await withNativeDeadline(()=>native.startSteps(),8000);
    if (cancelled() || !sensorsAllowed(getSettingsSnapshot())) {
      await withNativeDeadline(()=>native.stopSteps(),5000).catch(()=>{});
      return unavailable("Запуск шагомера отменён");
    }
    return result.started
      ? {ok:true,value:undefined}
      : unavailable("Android не подтвердил запуск датчика шагов");
    } catch (e) {
      await stopNativeDiagnostics();
      return safeError(e);
    } finally {
      if (cancelled() || !sensorsAllowed(getSettingsSnapshot()))
        await stopNativeDiagnostics();
    }
  });
}

// A privacy opt-out or route leave may request STOP multiple times from
// AppShell, Settings and Diagnostics. Coalesce only overlapping STOP calls;
// never skip the next STOP after the previous request has settled.
let diagnosticsStopInFlight: Promise<void> | null = null;
export function stopSensorDiagnostics(): Promise<void> {
  ++diagnosticEpoch; // revoke pending START immediately, even for coalesced STOP
  if (!androidSensorsAvailable()) return Promise.resolve();
  if (diagnosticsStopInFlight) return diagnosticsStopInFlight;
  // Immediate STOP plus serialized final STOP protect against a delayed start
  // that arrives after the user leaves the screen.
  void stopNativeDiagnostics();
  const pending=diagnosticOperations.enqueue(stopNativeDiagnostics);
  diagnosticsStopInFlight=pending;
  void pending.finally(()=>{
    if (diagnosticsStopInFlight===pending) diagnosticsStopInFlight=null;
  }).catch(()=>{});
  return pending;
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
  let ambientEpoch=0;
  let activityEpoch=0;
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
      startCapture: () => {
        if (!sensorsAllowed(getSettingsSnapshot()))
          return Promise.resolve(unavailable(SENSOR_MODE_BLOCKED));
        // The music adapter and the Diagnostics screen control the same native
        // AudioRecord. Use one serial lifecycle so STOP always wins over a
        // delayed start (permission prompt, route change or model loading).
        const epoch=++diagnosticEpoch;
        return diagnosticOperations.enqueue(async ():Promise<Result> => {
          const cancelled=()=>epoch!==diagnosticEpoch ||
            !sensorsAllowed(getSettingsSnapshot());
          if(cancelled())return unavailable("Запуск анализа отменён");
          try {
            const status=await withNativeDeadline(()=>native.status(),5000);
            if(cancelled())return unavailable("Запуск анализа отменён");
            if(!status.microphoneGranted)
              return {ok:false,code:"PERMISSION_DENIED" as const,
                message:"Разрешите микрофон при запуске музыки"};
            await withNativeDeadline(()=>native.setInputPreference({
              preference:effectiveMicrophonePreference(getSettingsSnapshot()),
            }),6000);
            if(cancelled())return unavailable("Запуск анализа отменён");
            const result=await withNativeDeadline(()=>native.startAnalysis(),12_000);
            if(cancelled())return unavailable("Запуск анализа отменён");
            if(result.started)ambientEpoch++;
            return result.started
              ? {ok:true as const,value:undefined}
              : unavailable("Модель YAMNet недоступна");
          }catch(e){
            await stopNativeDiagnostics();
            return safeError(e);
          }finally{
            if(cancelled())await stopNativeDiagnostics();
          }
        });
      },
      stopCapture: () => {
        ++diagnosticEpoch;
        // Do not wait for an old permission callback before telling Android
        // to release the microphone. The ordered stop below closes late starts.
        void Promise.resolve().then(()=>native.stopAnalysis()).catch(()=>undefined);
        return diagnosticOperations.enqueue(async ():Promise<Result> => {
          try {
            await withNativeDeadline(()=>native.stopAnalysis(),5000);
            return {ok:true as const,value:undefined};
          }catch(e){return safeError(e);}
          finally{ambientEpoch++;}
        });
      },
      observeEnvironment: cb => {
        const stability=new AmbientStabilizer();
        const routeFence=new SoundRouteFence();
        let seenEpoch=ambientEpoch;
        return observeRawSound(e=>{
        if (!sensorsAllowed(getSettingsSnapshot())) {
          stability.reset();routeFence.reset();return;
        }
        if(seenEpoch!==ambientEpoch){
          seenEpoch=ambientEpoch;stability.reset();routeFence.reset();
        }
        const age=Date.now()-e.timestamp;
        if(!Number.isSafeInteger(e.timestamp)||age< -1000||age>12000)return;
        // One physical Android mic route = one evidence stream. Different
        // headsets of the SAME type must still invalidate old observations.
        const route=routeFence.observe(e);
        if(route==="stale")return;
        if(route==="changed")stability.reset();
        const stable=stability.update(e);
        if (!stable) return;
        const mapped:EnvironmentEvent={label:stable.atmosphere,rawLabel:e.label,confidence:stable.confidence,timestamp:stable.timestamp,source:e.source};
        cb(mapped);
        });
      },
    },
    activity: {
      observeWalkingRunningTransportRest: cb => {
        const pace=new StepPaceEstimator();
        let seenEpoch=activityEpoch;
        return observeRawSteps(e=>{
        if (!sensorsAllowed(getSettingsSnapshot())) {
          activityEpoch++;pace.reset();return;
        }
        if(seenEpoch!==activityEpoch){seenEpoch=activityEpoch;pace.reset();}
        if(e.discontinuity===true)pace.reset();
        const age=Date.now()-e.timestamp;
        if(!Number.isSafeInteger(e.timestamp)||age< -1000||age>4500)return;
        const rate=pace.ingest(e.timestamp);
        if(rate.activity!=="unknown")cb({activity:rate.activity,confidence:rate.confidence,bpm:rate.bpm,timestamp:e.timestamp});
        });
      },
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
        try {const r=await native.actualMicrophone();return r.active&&r.routeConfirmed===true?{ok:true,value:{name:r.name,kind:r.kind}}:unavailable("Фактический маршрут микрофона пока не подтверждён");}
        catch(e){return safeError(e);}
      },
      verifyActualRoute:async()=>{
        try {const r=await native.actualMicrophone();return r.active&&r.routeConfirmed===true?{ok:true,value:{input:r.name,output:r.output}}:unavailable("Фактический вход Android пока не подтверждён");}
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
