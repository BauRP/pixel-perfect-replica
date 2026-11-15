import { createFileRoute } from "@tanstack/react-router";
import {useEffect,useRef,useState} from "react";
import { PageHeader, PendingBadge, Section } from "@/components/sw/ui";
import { Switch } from "@/components/ui/switch";
import {DIRECTOR_RULES,updateSettings,useSettings,getSettingsSnapshot} from "@/lib/sw/settings";
import {androidSensorsAvailable,observeRawSound,observeRawSteps} from "@/lib/sw/native-sensors";
import {AmbientStabilizer,StepPaceEstimator} from "@/lib/sw/environment-smoothing";
import {directorLivePreview,BirdEvidenceGate,type DirectorEvidence} from "@/lib/sw/director-live-preview";

export const Route = createFileRoute("/studio/director")({
  head: () => ({ meta: [{ title: "Музыкальный режиссёр — Studio" }, { name: "description", content: "Правила реакции музыки на звуки." }, { property: "og:title", content: "Музыкальный режиссёр" }, { property: "og:description", content: "Правила реакции музыки." }] }),
  component: Director,
});

function Director() {
  const s = useSettings();
  const [evidence,setEvidence]=useState<DirectorEvidence>({ambient:null,step:null});
  const [now,setNow]=useState(Date.now());
  const stabilizerRef=useRef(new AmbientStabilizer());
  const paceRef=useRef(new StepPaceEstimator());
  const birdsRef=useRef(new BirdEvidenceGate());
  useEffect(()=>{
    // Observe already-running Android sensors. Opening Studio never requests
    // microphone permission and never starts a recording or YAMNet session.
    const stabilizer=stabilizerRef.current;
    const pace=paceRef.current;
    const birds=birdsRef.current;
    const offSound=observeRawSound(event=>{
      if(getSettingsSnapshot().musicOnlyMode)return;
      if(!Number.isSafeInteger(event.timestamp) ||
        Math.abs(Date.now()-event.timestamp)>10_000)return;
      const confirmedBird=birds.ingest(event.label,event.confidence,event.timestamp);
      const stable=stabilizer.update(event);
      if(!stable && !(confirmedBird && stabilizer.stable==="nature"))return;
      const atmosphere=stable?.atmosphere??stabilizer.stable;
      setEvidence(prev=>({...prev,ambient:{
        at:Date.now(),atmosphere,birdLabel:atmosphere==="nature"&&birds.isRecent(event.timestamp),
      }}));
    });
    const offSteps=observeRawSteps(event=>{
      if(getSettingsSnapshot().musicOnlyMode || event.sensor!=="TYPE_STEP_DETECTOR")return;
      if(!Number.isSafeInteger(event.timestamp) ||
        Math.abs(Date.now()-event.timestamp)>10_000)return;
      const detected=pace.ingest(event.timestamp);
      if(detected.activity==="unknown")return;
      setEvidence(prev=>({...prev,step:{at:Date.now(),bpm:detected.bpm}}));
    });
    const timer=window.setInterval(()=>setNow(Date.now()),2000);
    return ()=>{offSound();offSteps();window.clearInterval(timer)};
  },[]);
  useEffect(()=>{
    // Invalidate ALL sensor history on privacy toggles. Re-enabling requires
    // two new actual windows rather than mixing pre-toggle samples.
    stabilizerRef.current.reset();
    paceRef.current.reset();
    birdsRef.current.reset();
    setEvidence({ambient:null,step:null});
  },[s.musicOnlyMode]);
  const liveRules=directorLivePreview(s,evidence,now);
  return (
    <>
      <PageHeader title="Музыкальный режиссёр" back />
      <div className="space-y-3 px-3 py-3">
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
          <PendingBadge />
          <p className="mt-2 text-foreground/90">Правила сохраняются, но начнут влиять на музыку только после подключения движка и анализа окружения.</p>
        </div>
        <Section>
          {DIRECTOR_RULES.map((r) => {
            const on = s.directorRules.find((x) => x.id === r.id)?.enabled ?? false;
            return (
              <label key={r.id} className="flex min-h-12 items-center gap-2 border-b border-border/50 px-3 py-1.5 last:border-0">
                <span className="min-w-0 flex-1 text-xs leading-snug"><b>{r.trigger}</b> → {r.effect}</span>
                <Switch checked={on} aria-label={`${r.trigger} — ${r.effect}`}
                  onCheckedChange={(v) => updateSettings((x) => ({ ...x, directorRules: x.directorRules.map((y) => (y.id === r.id ? { ...y, enabled: v } : y)) }))} />
              </label>
            );
          })}
        </Section>
        <Section title="Реальные срабатывания правил">
          <div className="space-y-2 p-3 text-xs" aria-live="polite">
            <p className="text-muted-foreground">
              {s.musicOnlyMode
                ?"Анализ окружения отключён в Настройках."
                :!androidSensorsAvailable()
                  ?"Настоящие показания доступны только в Android APK."
                  :"Просмотр уже работающих датчиков. Микрофон здесь не включается."}
            </p>
            {liveRules.map(rule=><p key={rule.id} className="flex items-center justify-between gap-2">
              <span>{rule.trigger}</span>
              <span className={rule.state==="detected"?"text-primary":"text-muted-foreground"}>
                {rule.state==="off"?"Выключено"
                  :rule.state==="detected"?"Условие подтверждено"
                  :"Нет свежего подтверждения"}
              </span>
            </p>)}
            <p className="text-muted-foreground">
              Это проверка реальных условий правил, не генерация музыки. Fermata/MNN ещё не подключены.
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}
