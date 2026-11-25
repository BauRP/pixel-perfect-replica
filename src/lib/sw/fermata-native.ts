/**
 * Native Fermata/MNN package inspection. This is a real bridge into Android,
 * not a music generator. A checked file inventory is NOT working inference.
 * All functions fail closed; no server, microphone or fabricated MIDI/PCM.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { registerAdapters, unavailableAdapters, type Result } from "./engine";
import { withNativeDeadline } from "./native-call-deadline";

export type FermataPackageStatus = {
  model:"haster/Fermata-0.2B-v1";
  runtime:"Alibaba/MNN";
  manifestPresent:boolean;
  modelPackaged:boolean;
  tokenizerPackaged:boolean;
  mnnPackaged:boolean;
  synthPackaged:boolean;
  soundbankPackaged:boolean;
  licenseEvidencePackaged:boolean;
  packageComplete:boolean;
  arm64Supported:boolean;
  generationReady:false;
};
type NativeFermata = {inspect():Promise<unknown>};
const native=registerPlugin<NativeFermata>("SoundWorldFermata");
const fields=[
  "manifestPresent","modelPackaged","tokenizerPackaged","mnnPackaged",
  "synthPackaged","soundbankPackaged","licenseEvidencePackaged",
  "packageComplete","arm64Supported",
] as const;

export function parseFermataPackageStatus(value:unknown):FermataPackageStatus|null {
  if(value===null || typeof value!=="object")return null;
  const data=value as Record<string,unknown>;
  if(data.model!=="haster/Fermata-0.2B-v1" || data.runtime!=="Alibaba/MNN")return null;
  const status:Record<string,unknown>={
    model:"haster/Fermata-0.2B-v1",runtime:"Alibaba/MNN",generationReady:false,
  };
  for(const field of fields) {
    if(typeof data[field]!=="boolean")return null;
    status[field]=data[field];
  }
  // A malicious/broken bridge claiming "generationReady" must never
  // enable AI until genuine model inference and PCM are integrated.
  return status as FermataPackageStatus;
}

export async function inspectFermataPackage():Promise<FermataPackageStatus|null> {
  if(Capacitor.getPlatform()!=="android")return null;
  try {
    return parseFermataPackageStatus(
      await withNativeDeadline(()=>native.inspect(),2500),
    );
  }catch {return null;}
}

export function explainFermataAvailability(status:FermataPackageStatus|null):string {
  if(!status)return "Fermata/MNN: модель и музыкальный движок не подключены";
  if(!status.manifestPresent)return "Fermata/MNN: веса модели и синтезатор не входят в APK";
  if(!status.packageComplete)return "Fermata/MNN: пакет музыкальной модели неполный";
  if(!status.arm64Supported)return "Fermata/MNN: нужен совместимый ARM64 Android";
  return "Fermata/MNN: файлы модели найдены, но генерация MIDI и звук ещё не подключены";
}

/** Inject only a genuine native capability check. Preserve all UNAVAILABLE
 * commands until Fermata-generated music is actually audible. */
export function installNativeFermataAdapter():void {
  if(Capacitor.getPlatform()!=="android")return;
  registerAdapters({engine:{
    ...unavailableAdapters.engine,
    checkAvailability:async():Promise<Result<{model:string}>>=>({
      ok:false,code:"UNAVAILABLE",
      message:explainFermataAvailability(await inspectFermataPackage()),
    }),
  }});
}
