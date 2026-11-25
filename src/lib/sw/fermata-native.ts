/**
 * Native Fermata/MNN package inspection. This is a real bridge into Android,
 * not a music generator. A checked file inventory is NOT working inference.
 * All functions fail closed; no server, microphone or fabricated MIDI/PCM.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { registerAdapters, unavailableAdapters, type Result } from "./engine";
import { withNativeDeadline } from "./native-call-deadline";
import type { FermataHeader } from "./fermata-conditioning";

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
type NativeFermata = {inspect():Promise<unknown>;encodeHeader(input:{tokens:string[]}):Promise<unknown>;decodeTokens(input:{tokenIds:number[]}):Promise<unknown>;prepareModel():Promise<unknown>;generateIds(input:{tokenIds:number[];maxTokens:number}):Promise<unknown>};
const native=registerPlugin<NativeFermata>("SoundWorldFermata");
const fields=[
  "manifestPresent","modelPackaged","tokenizerPackaged","mnnPackaged",
  "synthPackaged","soundbankPackaged","licenseEvidencePackaged",
  "packageComplete","arm64Supported",
] as const;

export function parseFermataPackageStatus(value:unknown):FermataPackageStatus|null {
  if(value===null || typeof value!=="object")return null;
  const data=value as Record<string,unknown>;
  if(data["model"]!=="haster/Fermata-0.2B-v1" || data["runtime"]!=="Alibaba/MNN")return null;
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

/** Real atomic header encoding through the packaged, hash-checked vocabulary.
 * No fallback tokenizer or invented IDs. Not a model-inference call. */
export async function encodeNativeFermataHeader(header:Readonly<FermataHeader>):Promise<readonly number[]> {
  if(Capacitor.getPlatform()!=="android")
    throw new Error("Оригинальный токенизатор Fermata доступен только в Android");
  const result=await withNativeDeadline(()=>native.encodeHeader({tokens:[...header.tokens]}),5000);
  const ids=(result as {tokenIds?:unknown}|null)?.tokenIds;
  if(!Array.isArray(ids)||ids.length!==header.tokens.length||
     ids.some(id=>typeof id!=="number"||!Number.isSafeInteger(id)||id<0||id>=9507))
    throw new Error("Неверные номера оригинальных токенов Fermata");
  return Object.freeze([...ids] as number[]);
}

export async function decodeNativeFermataTokens(ids:readonly number[]):Promise<readonly string[]> {
  if(Capacitor.getPlatform()!=="android"||ids.length<1||ids.length>4096||
     ids.some(id=>!Number.isSafeInteger(id)||id<0||id>=9507))
    throw new Error("Неверный результат музыкальной модели Fermata");
  const result=await withNativeDeadline(()=>native.decodeTokens({tokenIds:[...ids]}),5000);
  const tokens=(result as {tokens?:unknown}|null)?.tokens;
  if(!Array.isArray(tokens)||tokens.length!==ids.length||
     tokens.some(token=>typeof token!=="string"||token.length===0))
    throw new Error("Некорректные музыкальные токены Fermata");
  return Object.freeze([...tokens] as string[]);
}

/** Explicit developer/runtime preparation, never invoked during UI startup. */
export async function prepareNativeFermataModel():Promise<string> {
  if(Capacitor.getPlatform()!=="android")throw new Error("MNN доступен только в Android");
  const value=await withNativeDeadline(()=>native.prepareModel(),120_000);
  const directory=(value as {modelDirectory?:unknown}|null)?.modelDirectory;
  if(typeof directory!=="string"||!directory.startsWith("/")||
     !directory.endsWith("/fermata-mnn-v1"))
    throw new Error("Не подготовлены локальные файлы MNN");
  return directory;
}

/** Run actual model inference with original atomic token IDs. The full
 * player remains unavailable until the musical decoder and synth exist. */
export async function generateNativeFermataTokens(header:Readonly<FermataHeader>,
    maxTokens=2048):Promise<readonly string[]> {
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>4096)
    throw new Error("Некорректное ограничение генерации");
  await prepareNativeFermataModel();
  const ids=await encodeNativeFermataHeader(header);
  // The native call remains occupied until MNN returns; do not create a
  // second model in response to a JavaScript timeout.
  const value=await native.generateIds({tokenIds:[...ids],maxTokens});
  const output=(value as {tokenIds?:unknown}|null)?.tokenIds;
  if(!Array.isArray(output)||output.length<1||output.length>maxTokens||
     output.some(id=>typeof id!=="number"||!Number.isSafeInteger(id)||id<0||id>=9507))
    throw new Error("MNN не вернула настоящие музыкальные токены");
  return decodeNativeFermataTokens(output as number[]);
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
