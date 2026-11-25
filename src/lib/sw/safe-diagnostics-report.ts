/**
 * Explicit offline diagnostic report: only allow-listed Android metrics.
 * No audio, transcript, Bluetooth names, locations, file paths, UUIDs or
 * raw exception messages can be exported by this builder.
 */
export type DiagnosticSnapshot = {
  android:boolean; musicOnly:boolean; active:boolean; stepsOnly:boolean;
  stepCount:number|null;
  sensors?:{yamnetIncluded?:boolean;stepsSupported?:boolean;stepsActive?:boolean;activityGranted?:boolean;microphoneGranted?:boolean;recording?:boolean;captureRateHz?:number}|null;
  performance?:{battery?:number;ramMb?:number;thermalStatus?:number;lowMemory?:boolean;inferenceSkipped?:number;inferenceThrottled?:number;analysisStride?:number;analysisActive?:boolean}|null;
  pcm?:{serviceActive?:boolean;readyForPcm?:boolean;underruns?:number}|null;
  wav?:{state?:string}|null;
};
const yn=(x:unknown):string=>x===true?"да":x===false?"нет":"нет данных";
const integer=(v:unknown,min:number,max:number):string=>
  typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max?String(v):"нет данных";
export function buildSafeDiagnosticsReport(s:DiagnosticSnapshot):string {
  return [
    "SoundWorld AR · диагностический отчёт",
    "Содержит только состояния функций и числовые показатели Android",
    "Платформа: "+(s.android?"Android":"Браузер"),
    "Без анализа окружения: "+yn(s.musicOnly),
    "Проверка датчиков: "+yn(s.active),
    "Только шаги: "+yn(s.stepsOnly),
    "Шагов за проверку: "+integer(s.stepCount,0,10000000),
    "YAMNet в APK: "+yn(s.sensors?.yamnetIncluded),
    "Датчик шагов: "+yn(s.sensors?.stepsSupported),
    "Разрешение активности: "+yn(s.sensors?.activityGranted),
    "Шагомер Android запущен: "+yn(s.sensors?.stepsActive),
    "Разрешение микрофона: "+yn(s.sensors?.microphoneGranted),
    "Захват микрофона: "+yn(s.sensors?.recording),
    "Частота микрофона (Гц): "+integer(s.sensors?.captureRateHz,8000,192000),
    "Заряд (%): "+integer(s.performance?.battery,0,100),
    "Свободная RAM (МБ): "+integer(s.performance?.ramMb,0,1048576),
    "Тепловой статус (0–6): "+integer(s.performance?.thermalStatus,0,6),
    "Нехватка памяти: "+yn(s.performance?.lowMemory),
    "Пропусков анализа YAMNet: "+integer(s.performance?.inferenceSkipped,0,100000000),
    "Окон экономии YAMNet: "+integer(s.performance?.inferenceThrottled,0,100000000),
    "Анализ YAMNet запущен: "+yn(s.performance?.analysisActive),
    "Частота проверки YAMNet, каждое N-е окно: "+integer(s.performance?.analysisStride,1,32),
    "PCM-служба: "+yn(s.pcm?.serviceActive),
    "PCM готова: "+yn(s.pcm?.readyForPcm),
    "Пропуски AudioTrack: "+integer(s.pcm?.underruns,0,100000000),
    "WAV: "+(
      s.wav?.state==="playing"?"играет":
      s.wav?.state==="paused"?"пауза":
      s.wav?.state==="preparing"?"подготовка":
      s.wav?.state==="stopped"?"остановлен":"нет данных"),
    "Fermata/MNN: не подключена",
  ].join("\n");
}
/** Never report success until Clipboard API or WebView fallback confirms. */
export async function copySafeDiagnosticsReport(text:string,opts?:{
  clipboard?:{writeText(text:string):Promise<void>}|null;
  fallback?:()=>boolean;
}):Promise<boolean> {
  if(!text)return false;
  const clipboard=opts?.clipboard===undefined
    ? typeof navigator==="undefined"?null:navigator.clipboard : opts.clipboard;
  if(clipboard?.writeText)try{await clipboard.writeText(text);return true;}catch{}
  if(opts?.fallback)try{return opts.fallback()===true;}catch{return false;}
  if(typeof document==="undefined"||!document.body||
      typeof document.execCommand!=="function")return false;
  const field=document.createElement("textarea");
  field.value=text;field.readOnly=true;field.setAttribute("aria-hidden","true");
  field.style.position="fixed";field.style.left="-9999px";field.style.top="0";
  document.body.appendChild(field);
  try{field.focus();field.select();return document.execCommand("copy")===true;}
  catch{return false;}finally{field.remove();}
}
