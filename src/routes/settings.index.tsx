import { createFileRoute } from "@tanstack/react-router";
import { Mic, Shield, FileText, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavRow, PageHeader, PendingBadge, Section, Segmented } from "@/components/sw/ui";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetSettings, updateSettings, useSettings, type Settings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { androidSensorsAvailable, sensorStatus, observeActualRouteChanges, getNativePerformanceSnapshot, stopSensorDiagnostics, type SensorsStatus } from "@/lib/sw/native-sensors";
import { deviceHealthAlerts, deviceHealthReadout, realYamnetPowerReadout } from "@/lib/sw/device-health";
import { currentStoredPlayback } from "@/lib/sw/native-music-library";
import { describeSavedWavRoute } from "@/lib/sw/saved-wav-output-route";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "Настройки — SoundWorld AR" }, { name: "description", content: "Общие настройки приложения SoundWorld AR." }, { property: "og:title", content: "Настройки — SoundWorld AR" }, { property: "og:description", content: "Общие настройки приложения." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: SettingsPage,
});

const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings((s) => ({ ...s, [k]: v }));

function ToggleRow({ title, desc, checked, onChange }: { title: string; desc: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center gap-2 border-b border-border/50 px-3 py-2 last:border-0">
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium leading-snug">{title}</span><span className="block text-[11px] leading-snug text-muted-foreground">{desc}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

function SettingsPage() {
  const s = useSettings();
  const [device,setDevice] = useState<SensorsStatus | null>(null);
  const [health,setHealth] = useState<Awaited<ReturnType<typeof getNativePerformanceSnapshot>>>(null);
  const [wavRoute,setWavRoute] = useState<Awaited<ReturnType<typeof currentStoredPlayback>>>(null);
  const warnings=deviceHealthAlerts(health);
  useEffect(() => {
    let live=true;
    let readingStatus=false;
    const refresh=()=>{
      if(readingStatus)return;
      readingStatus=true;
      void sensorStatus().then(x=>{if(live)setDevice(x)}).finally(()=>{readingStatus=false});
    };
    let reading=false;
    const refreshHealth=()=>{
      if(reading)return;
      reading=true;
      void getNativePerformanceSnapshot().then(x=>{if(live)setHealth(x)}).finally(()=>{reading=false});
    };
    let routeReading=false;
    const refreshWavRoute=()=>{
      if(routeReading)return;
      routeReading=true;
      void currentStoredPlayback().then(x=>{if(live)setWavRoute(x)}).finally(()=>{routeReading=false});
    };
    refresh();refreshHealth();refreshWavRoute();
    // Only while the Settings page is mounted. Android's MediaPlayer
    // route is reported after preparation and may change when switching
    // between speaker, wired headphones and Bluetooth.
    const timer=window.setInterval(refreshHealth,15000);
    const routeTimer=window.setInterval(()=>{refresh();refreshWavRoute()},5000);
    const off=observeActualRouteChanges(()=>{refresh();refreshWavRoute()});
    return ()=>{live=false;window.clearInterval(timer);window.clearInterval(routeTimer);off()};
  },[]);
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="space-y-3 px-3 py-3">
        <Section title="Звук и микрофон">
          <ToggleRow title="Автоматический выбор устройства" desc="При включении используется предпочтительный доступный микрофон. При выключении и выборе «Автоматически» используется микрофон телефона" checked={s.autoAudioRouting} onChange={(v) => set("autoAudioRouting", v)} />
          <div className="space-y-1.5 px-3 py-2">
            <Segmented label="Предпочитаемый микрофон" value={s.microphonePreference} onChange={(v) => set("microphonePreference", v)}
              options={[{value:"auto",label:"Автоматически"},{value:"headset",label:"Наушники"},{value:"phone",label:"Телефон"}]} />
            <p className="text-xs text-muted-foreground">Это предпочтение. Фактически выбранный микрофон проверяется после начала записи.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <Mic className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm">Активный микрофон</span>
            <span className="text-right text-xs text-warning">{device?.recording ? device.actualInput || "Определяется" : "Микрофон не используется"}</span>
          </div>
          {device?.recording && s.microphonePreference==="headset" &&
            device.actualInputCategory==="phone" &&
            <p role="status" className="px-3 pb-2 text-xs text-warning">
              Наушники выбраны как предпочтение, но Android сейчас использует микрофон телефона.
              Изменение предпочтения не означает, что устройство действительно переключилось.
            </p>}
        </Section>

        <Section title="Воспроизведение">
          <div className="space-y-1 px-3 py-2" aria-label="Фактический аудиовыход сохранённой музыки">
            <p className="text-sm font-medium">Куда Android выводит сохранённый WAV</p>
            <p className="text-xs text-muted-foreground" role="status">
              {androidSensorsAvailable()?describeSavedWavRoute(wavRoute):"Фактический маршрут доступен только в Android APK"}
            </p>
            <p className="text-xs text-muted-foreground">
              Показывается реальный маршрут MediaPlayer, не выбранный микрофон. При отсутствии воспроизведения устройство не угадывается.
            </p>
          </div>
          <ToggleRow title="Продолжать после звонка" desc="Для сохранённых WAV применяется при кратковременном прерывании звонком. Для генерации новой музыки заработает после подключения движка" checked={s.afterCallAutoResume} onChange={(v) => set("afterCallAutoResume", v)} />
          <ToggleRow title="Без анализа окружения" desc="Автоматический анализ и проверка микрофона и шагов отключаются до выключения режима" checked={s.musicOnlyMode}
            onChange={(v) => {set("musicOnlyMode",v);if(v)void stopSensorDiagnostics();}} />
        </Section>

        <Section title="Экономия заряда">
          <div className="space-y-1.5 p-3">
            <Segmented label="Экономия заряда" value={s.batteryMode} onChange={(v) => set("batteryMode", v)}
              options={[{ value: "auto", label: "Автоматически" }, { value: "maxPerformance", label: "Максимальная производительность" }]} />
            <p className="text-xs text-muted-foreground">Режим уже управляет частотой распознавания окружения YAMNet с учётом нагрева и заряда. Для будущей генерации Fermata управление нагрузкой ещё не подключено.</p>
            <p className="text-xs text-muted-foreground" role="status">Данные Android: {deviceHealthReadout(health)}</p>
            <p className="text-xs text-muted-foreground" role="status">
              Реальная экономия YAMNet: {realYamnetPowerReadout(health)}
            </p>
            {warnings.length>0 && <ul aria-label="Предупреждения Android о нагрузке" className="space-y-1 text-xs" role="list">
              {warnings.map(w=><li key={w.id} className={w.severity==="critical"?"text-destructive":w.severity==="warning"?"text-warning":"text-muted-foreground"}>{w.message}</li>)}
            </ul>}
          </div>
        </Section>

        <Section title="Безопасная прогулка">
          <div className="space-y-1.5 p-3 text-sm">
            <div className="flex items-center gap-2"><Shield className="size-5 text-primary" /><span className="flex-1 font-medium">Защита от резких скачков громкости</span><PendingBadge /></div>
            <p className="text-xs text-muted-foreground">Приложение не может надёжно распознавать опасность. Всегда следите за дорогой и окружением.</p>
          </div>
        </Section>

        <Section title="Разрешения и система">
          <div className="space-y-1 px-3 py-2 text-sm">
            <p>Микрофон: <span className="text-muted-foreground">{!androidSensorsAvailable()?"В браузере недоступен":device?.microphoneGranted?"Разрешён":"Разрешение не предоставлено"}</span></p>
            <p>Уведомления и кнопки гарнитуры: <span className="text-muted-foreground">для сохранённых WAV доступны при воспроизведении в Android APK; для живой генерации пока не подключены</span></p>
            <p className="text-xs text-muted-foreground">Микрофон не включается до нажатия Play. Звук не отправляется в интернет.</p>
          </div>
          <NavRow to="/settings/about" title="Лицензии и приватность" icon={<FileText className="size-5" />} />
        </Section>

        <Section title="Для разработчиков (временно)">
          <NavRow to="/settings/diagnostics" title="Диагностика" icon={<Wrench className="size-5" />} />
        </Section>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="min-h-12 w-full rounded-2xl border border-destructive/50 text-sm font-semibold text-destructive">Сбросить настройки</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Сбросить все настройки?</AlertDialogTitle>
              <AlertDialogDescription>Вкусы и настройки Studio вернутся к исходным, снова откроется выбор жанров. Избранное и сохранённые файлы не удаляются.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={() => { resetSettings(); notify.saved("Настройки сброшены"); }}>Сбросить</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
