/**
 * Capacitor bridge to actual Android YAMNet and motion sensors.
 * Does not install a music engine. Never synthesizes audio or fake detections.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import {
  registerAdapters, type Adapters, type EnvironmentEvent, type Result, type Unsubscribe,
} from "./engine";
import { AmbientStabilizer, StepPaceEstimator, type Atmosphere } from "./environment-smoothing";

type NativeResult = { started?: boolean; stopped?: boolean; granted?: boolean; active?: boolean; name?: string; kind?: string; input?: string; output?: string };
export interface SensorsStatus {
  yamnetIncluded: boolean;
  microphoneGranted: boolean;
  activityGranted: boolean;
  stepsSupported: boolean;
  recording: boolean;
  actualInput: string;
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
  startAnalysis(): Promise<NativeResult>;
  startMicrophoneProbe(): Promise<NativeResult>;
  stopMicrophoneProbe(): Promise<NativeResult>;
  stopAnalysis(): Promise<NativeResult>;
  startSteps(): Promise<NativeResult>;
  stopSteps(): Promise<NativeResult>;
  actualMicrophone(): Promise<{ name: string; kind: string; active: boolean; output: string }>;
  addListener(event: "yamnet" | "step" | "analysisError" | "micLevel", callback: (value: any) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<SensorsPlugin>("SoundWorldSensors");
export const androidSensorsAvailable = () => Capacitor.getPlatform() === "android";
const unavailable = (message: string): {ok:false;code:"UNAVAILABLE";message:string} => ({ ok: false, code: "UNAVAILABLE", message });
const safeError = (e: unknown): {ok:false;code:"ERROR";message:string} => ({
  ok: false,
  code: "ERROR",
  message: e instanceof Error ? e.message : "Ошибка модуля Android",
});
export async function sensorStatus(): Promise<SensorsStatus | null> {
  if (!androidSensorsAvailable()) return null;
  try { return await native.status(); } catch { return null; }
}
export async function startSensorDiagnostics(includeSteps: boolean): Promise<Result> {
  if (!androidSensorsAvailable()) return unavailable("Только в Android APK");
  try {
    const permission = await native.requestMicrophone();
    if (!permission.granted) return {ok:false,code:"PERMISSION_DENIED",message:"Микрофон не разрешён"};
    const r = await native.startMicrophoneProbe();
    if (!r.started) return unavailable("Проверка микрофона не запущена");
    if (includeSteps) {
      const activity = await native.requestActivity();
      if (activity.granted) await native.startSteps();
    }
    return {ok:true,value:undefined};
  } catch(e) { return safeError(e); }
}
export async function stopSensorDiagnostics(): Promise<void> {
  if (!androidSensorsAvailable()) return;
  await Promise.allSettled([native.stopMicrophoneProbe(),native.stopSteps()]);
}
function subscribe<T>(event: "yamnet"|"step"|"analysisError"|"micLevel", cb: (data:T)=>void):Unsubscribe {
  if (!androidSensorsAvailable()) return () => {};
  let closed = false;
  const handle = native.addListener(event, data=>{if(!closed) cb(data as T);});
  return () => {closed=true; void handle.then(h=>h.remove()).catch(()=>{});};
}
export function observeRawSound(cb:(sound:RawSound)=>void):Unsubscribe { return subscribe("yamnet",cb); }
export function observeMicrophoneLevel(cb:(level:{rms:number;timestamp:number;input:string})=>void):Unsubscribe {return subscribe("micLevel",cb);}
export function observeRawSteps(cb:(step:RawStep)=>void):Unsubscribe { return subscribe("step",cb); }
export function observeSensorErrors(cb:(message:string)=>void):Unsubscribe {
  return subscribe<{message:string}>("analysisError",e=>cb(e.message));
}

/** Use real native data only. No microphone/sensor capture before an explicit Play/test action. */
export function installNativeSensorAdapters(): void {
  if (!androidSensorsAvailable()) return;
  const stability = new AmbientStabilizer();
  const pace = new StepPaceEstimator();
  const adapters: Partial<Adapters> = {
    permissions: {
      microphone: async () => {
        const s=await sensorStatus();
        return s?{ok:true,value:s.microphoneGranted?"granted" as const:"prompt" as const}:unavailable("Нет данных о разрешении");
      },
      requestMicrophone: async () => {
        try {const r=await native.requestMicrophone();return {ok:true,value:r.granted?"granted" as const:"denied" as const};}
        catch(e){return safeError(e);}
      }
    },
    environment: {
      checkAvailability: async () => {
        const s=await sensorStatus();
        return s?.yamnetIncluded?{ok:true,value:undefined}:unavailable("Файл YAMNet отсутствует");
      },
      startCapture: async () => {
        try {
          const s=await native.status();
          if(!s.microphoneGranted) return {ok:false,code:"PERMISSION_DENIED",message:"Разрешите микрофон при запуске музыки"};
          return unavailable("Нейросеть YAMNet не включена в APK; захват доступен только в диагностике");
        }catch(e){return safeError(e);}
      },
      stopCapture: async () => {
        try {await native.stopAnalysis();stability.reset();return {ok:true,value:undefined};}
        catch(e){return safeError(e);}
      },
      observeEnvironment: cb => observeRawSound(e=>{
        const stable=stability.update(e);
        if (!stable) return;
        const mapped:EnvironmentEvent={label:stable.atmosphere,confidence:stable.confidence,timestamp:stable.timestamp,source:e.source};
        cb(mapped);
      }),
    },
    activity: {
      observeWalkingRunningTransportRest: cb => observeRawSteps(e=>{
        const rate=pace.ingest(e.timestamp);
        if(rate.activity!=="unknown")cb({activity:rate.activity,confidence:rate.confidence});
      }),
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
      chooseBestSupportedRoute:async()=>unavailable("Выбор маршрута выполняется при запуске записи; переключение на лету пока недоступно"),
      observeInputOutputChanges:()=>()=>{},
    }
  };
  registerAdapters(adapters);
}
export const ATMOSPHERE_RU: Record<Atmosphere,string> = {
  rain:"Дождь", traffic:"Транспорт", nature:"Природа", indoor:"Помещение", unknown:"Обстановка не определена"
};
