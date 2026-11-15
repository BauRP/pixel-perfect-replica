/**
 * Real Android battery/thermal/memory health readout.
 * Values originate ONLY from BatteryManager, PowerManager thermal status and
 * ActivityManager.MemoryInfo. No synthetic Celsius/CPU temperature is shown.
 * The native power policy already decides actual inference throttling.
 */
export interface DeviceHealthSnapshot {
  battery?: number;
  thermalStatus?: number;
  lowMemory?: boolean;
  ramMb?: number;
}
export type DeviceHealthAlert = Readonly<{
  id: "heat"|"battery"|"memory";
  severity: "notice"|"warning"|"critical";
  message: string;
}>;

export function deviceHealthAlerts(s:DeviceHealthSnapshot|null|undefined):DeviceHealthAlert[] {
  if(!s)return [];
  const alerts:DeviceHealthAlert[]=[];
  if(Number.isInteger(s.thermalStatus) && s.thermalStatus! >= 3 && s.thermalStatus! <= 6) {
    alerts.push({
      id:"heat",
      severity:s.thermalStatus! >= 4?"critical":"warning",
      message:s.thermalStatus! >= 4
        ?"Android сообщает о критическом нагреве. Уменьшите нагрузку и дайте устройству остыть."
        :"Android сообщает о сильном нагреве. Распознавание звуков автоматически замедляется.",
    });
  } else if(s.thermalStatus === 2) {
    alerts.push({id:"heat",severity:"notice",message:"Android сообщает об умеренном нагреве."});
  }
  if(Number.isInteger(s.battery) && s.battery! >= 0 && s.battery! <= 15)
    alerts.push({
      id:"battery",severity:s.battery! <= 5?"critical":"warning",
      message:"Низкий заряд: "+s.battery+"%. При необходимости подключите питание.",
    });
  if(s.lowMemory === true)
    alerts.push({
      id:"memory",severity:"warning",
      message:"Android сообщает о нехватке памяти. Фоновая работа может прерываться.",
    });
  return alerts;
}

export function deviceHealthReadout(s:DeviceHealthSnapshot|null|undefined):string {
  if (!s)return "Android не предоставил показатели";
  const fields:string[]=[];
  if(Number.isInteger(s.battery) && s.battery! >= 0 && s.battery! <= 100)fields.push("заряд "+s.battery+"%");
  if(Number.isInteger(s.ramMb) && s.ramMb! >= 0)fields.push("свободная память "+s.ramMb+" МБ");
  if(Number.isInteger(s.thermalStatus) && s.thermalStatus! >= 0 && s.thermalStatus! <= 6)
    fields.push("тепловой статус Android "+s.thermalStatus);
  return fields.length?fields.join(" · "):"Android не предоставил показатели";
}

/** Only actionable Android warnings appear on the Player screen.
 * Informational heat notices stay in Settings to avoid constant UI noise.
 * Missing native measurements produce an empty list, never fake danger. */
export function significantPlayerHealthAlerts(
  s:DeviceHealthSnapshot|null|undefined,
):DeviceHealthAlert[] {
  return deviceHealthAlerts(s).filter(alert=>alert.severity!=="notice");
}

/** Explicit Android YAMNet throttling state. Only an actual classifier
 * session with real microphone capture may be labelled active. A plain
 * microphone test is NOT proof YAMNet inference is running. */
export interface YamnetPowerSnapshot {
  analysisActive?:boolean;
  recording?:boolean;
  analysisStride?:number;
  inferenceThrottled?:number;
}
export function realYamnetPowerReadout(s:YamnetPowerSnapshot|null|undefined):string {
  if(!s)return "Данных Android пока нет";
  if(s.analysisActive!==true || s.recording!==true)
    return "Анализ YAMNet сейчас не запущен";
  if(!Number.isSafeInteger(s.analysisStride) || s.analysisStride!<1 || s.analysisStride!>32)
    return "Android не подтвердил частоту анализа";
  const cadence=s.analysisStride===1?"Проверяется каждое окно звука":
    "Проверяется каждое "+s.analysisStride+"-е окно звука";
  const skipped=Number.isSafeInteger(s.inferenceThrottled) &&
    s.inferenceThrottled!>=0 && s.inferenceThrottled!<=100_000_000
      ?" · пропущено для экономии "+s.inferenceThrottled:"";
  return cadence+skipped;
}
