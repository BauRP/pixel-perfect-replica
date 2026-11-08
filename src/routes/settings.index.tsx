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
import { androidSensorsAvailable, sensorStatus, type SensorsStatus } from "@/lib/sw/native-sensors";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "Настройки — SoundWorld AR" }, { name: "description", content: "Общие настройки приложения SoundWorld AR." }, { property: "og:title", content: "Настройки — SoundWorld AR" }, { property: "og:description", content: "Общие настройки приложения." }] }),
  component: SettingsPage,
});

const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings((s) => ({ ...s, [k]: v }));

function ToggleRow({ title, desc, checked, onChange }: { title: string; desc: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 border-b border-border/50 px-4 py-3 last:border-0">
      <span className="flex-1"><span className="block font-medium">{title}</span><span className="block text-xs text-muted-foreground">{desc}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

function SettingsPage() {
  const s = useSettings();
  const [device,setDevice] = useState<SensorsStatus | null>(null);
  useEffect(() => {
    let live=true;
    void sensorStatus().then(x=>{if(live)setDevice(x)});
    return ()=>{live=false};
  },[]);
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="space-y-5 px-4 py-4">
        <Section title="Звук и микрофон">
          <ToggleRow title="Автоматический выбор устройства" desc="Микрофон гарнитуры, если работает, иначе телефона" checked={s.autoAudioRouting} onChange={(v) => set("autoAudioRouting", v)} />
          <div className="space-y-2 px-4 py-3">
            <Segmented label="Предпочитаемый микрофон" value={s.microphonePreference} onChange={(v) => set("microphonePreference", v)}
              options={[{value:"auto",label:"Автоматически"},{value:"headset",label:"Наушники"},{value:"phone",label:"Телефон"}]} />
            <p className="text-xs text-muted-foreground">Это предпочтение. Фактически выбранный микрофон проверяется после начала записи.</p>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Mic className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm">Активный микрофон</span>
            <span className="text-right text-xs text-warning">{device?.recording ? device.actualInput || "Определяется" : "Микрофон не используется"}</span>
          </div>
        </Section>

        <Section title="Воспроизведение">
          <ToggleRow title="Продолжать после звонка" desc="Если до звонка была пауза, музыка сама не включится" checked={s.afterCallAutoResume} onChange={(v) => set("afterCallAutoResume", v)} />
          <ToggleRow title="Без анализа окружения" desc="Только музыка по настройкам Studio, без микрофона и шагов" checked={s.musicOnlyMode} onChange={(v) => set("musicOnlyMode", v)} />
        </Section>

        <Section title="Экономия заряда">
          <div className="space-y-2 p-4">
            <Segmented label="Экономия заряда" value={s.batteryMode} onChange={(v) => set("batteryMode", v)}
              options={[{ value: "auto", label: "Автоматически" }, { value: "maxPerformance", label: "Максимальная производительность" }]} />
            <p className="text-xs text-muted-foreground">Защита от перегрева и слуха работает в обоих режимах. Сам режим начнёт действовать после подключения нативных модулей.</p>
          </div>
        </Section>

        <Section title="Безопасная прогулка">
          <div className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2"><Shield className="size-5 text-primary" /><span className="flex-1 font-medium">Защита от резких скачков громкости</span><PendingBadge /></div>
            <p className="text-xs text-muted-foreground">Приложение не может надёжно распознавать опасность. Всегда следите за дорогой и окружением.</p>
          </div>
        </Section>

        <Section title="Разрешения и система">
          <div className="space-y-1 px-4 py-3 text-sm">
            <p>Микрофон: <span className="text-muted-foreground">{!androidSensorsAvailable()?"В браузере недоступен":device?.microphoneGranted?"Разрешён":"Разрешение не предоставлено"}</span></p>
            <p>Уведомления и кнопки гарнитуры: <span className="text-muted-foreground">появятся с фоновым воспроизведением Android</span></p>
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
