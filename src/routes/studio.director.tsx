import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PendingBadge, Section } from "@/components/sw/ui";
import { Switch } from "@/components/ui/switch";
import { DIRECTOR_RULES, updateSettings, useSettings } from "@/lib/sw/settings";

export const Route = createFileRoute("/studio/director")({
  head: () => ({ meta: [{ title: "Музыкальный режиссёр — Studio" }, { name: "description", content: "Правила реакции музыки на звуки." }, { property: "og:title", content: "Музыкальный режиссёр" }, { property: "og:description", content: "Правила реакции музыки." }] }),
  component: Director,
});

function Director() {
  const s = useSettings();
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
      </div>
    </>
  );
}
