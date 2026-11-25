/** Local Android-only watchdog. Does NOT read privileged Logcat or phone data. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { withNativeDeadline } from "./native-call-deadline";
import { copySafeDiagnosticsReport } from "./safe-diagnostics-report";

export interface StoredFreezeEvidence {
  report:string;
  recordedAt:number;
  jsIssue:string;
  jsIssueAt:number;
}
interface FreezeNative {
  pulse():Promise<void>;
  traceScreen(options:{screen:string}):Promise<void>;
  recordJsIssue(options:{kind:"javascript-error"|"unhandled-rejection"}):Promise<void>;
  read():Promise<StoredFreezeEvidence>;
  copy(options:{text:string}):Promise<void>;
}
const native=registerPlugin<FreezeNative>("SoundWorldFreeze");
const isAndroid=()=>Capacitor.getPlatform()==="android";

export async function readFreezeEvidence():Promise<StoredFreezeEvidence|null> {
  if (!isAndroid()) return null;
  try {return await withNativeDeadline(()=>native.read(),2500);}
  catch {return null;}
}

export async function copySupportReport(report:string):Promise<boolean> {
  if(!report || report.length>12000)return false;
  if (isAndroid()) {
    try {await withNativeDeadline(()=>native.copy({text:report}),3000);return true;}
    catch { /* A missing emulator clipboard may fall back to WebView. */ }
  }
  return copySafeDiagnosticsReport(report);
}

/** Every category is an allowlisted constant. No error text, path or user
 * input ever enters an automatically stored report. */
export function installFreezeMonitoring():()=>void {
  if(!isAndroid() || typeof window==="undefined")return ()=>{};
  let disposed=false;
  let outstanding=false;
  let failures=0;
  let lastAttempt=0;
  const beat=()=>{
    if(disposed||outstanding||document.hidden)return;
    const now=Date.now();
    if(now-lastAttempt<Math.min(30000,2000*(2**Math.min(4,failures))))return;
    lastAttempt=now;
    outstanding=true;
    void withNativeDeadline(()=>native.pulse(),1500).then(
      ()=>{failures=0;},()=>{failures=Math.min(4,failures+1);},
    ).finally(()=>{outstanding=false;});
  };
  // Reporting itself must not flood Capacitor when one faulty handler loops.
  const lastIssueRequest:Record<"javascript-error"|"unhandled-rejection",number>={
    "javascript-error":0,"unhandled-rejection":0,
  };
  const markIssue=(kind:"javascript-error"|"unhandled-rejection")=>{
    if(disposed)return;
    const now=Date.now();
    if(now-lastIssueRequest[kind]<5000)return;
    lastIssueRequest[kind]=now;
    void withNativeDeadline(()=>native.recordJsIssue({kind}),1500).catch(()=>{});
  };
  const markError=()=>markIssue("javascript-error");
  const markRejection=()=>markIssue("unhandled-rejection");
  window.addEventListener("error",markError);
  window.addEventListener("unhandledrejection",markRejection);
  document.addEventListener("visibilitychange",beat);
  // Immediate pulse is required to distinguish a bad startup from later ANR.
  lastAttempt=0;
  beat();
  const timer=window.setInterval(beat,2000);
  return ()=>{
    disposed=true;
    window.clearInterval(timer);
    window.removeEventListener("error",markError);
    window.removeEventListener("unhandledrejection",markRejection);
    document.removeEventListener("visibilitychange",beat);
  };
}
export function traceFreezeScreen(path:string):void {
  if(!isAndroid())return;
  const section=path.startsWith("/settings/diagnostics")?"diagnostics"
    :path.startsWith("/settings")?"settings"
    :path.startsWith("/studio")?"studio"
    :path.startsWith("/history")?"history"
    :path.startsWith("/onboarding")?"onboarding":"player";
  void withNativeDeadline(()=>native.traceScreen({screen:section}),1500).catch(()=>{});
}

export function buildSupportReport(
  evidence:StoredFreezeEvidence|null, currentDiagnostics:string,
):string {
  const recorded=evidence && Number.isFinite(evidence.recordedAt) &&
    evidence.recordedAt>0 ? new Date(evidence.recordedAt).toISOString() : "нет";
  const issueAt=evidence && Number.isFinite(evidence.jsIssueAt) &&
    evidence.jsIssueAt>0 ? new Date(evidence.jsIssueAt).toISOString() : "нет";
  const issue=evidence?.jsIssue==="javascript-error"?"Ошибка JavaScript"
    :evidence?.jsIssue==="unhandled-rejection"?"Необработанная ошибка Promise":"нет";
  const saved=(evidence?.report || "").slice(0,5500);
  return [
    "SoundWorld AR · Отчёт об ошибках",
    "Собран локально, без отправки на сервер. Не является полным системным Logcat.",
    "Дата последнего обнаруженного зависания: "+recorded,
    "Сохранённые сведения о зависании:",
    saved || "Автоматически обнаруженных зависаний пока нет",
    "Последняя ошибка JavaScript: "+issue+"; дата: "+issueAt,
    "",
    currentDiagnostics,
  ].join("\n").slice(0,11000);
}
