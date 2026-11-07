import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sw/ui";

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => ({ meta: [{ title: "Диагностика — SoundWorld AR" }, { name: "description", content: "Временный раздел диагностики." }, { property: "og:title", content: "Диагностика" }, { property: "og:description", content: "Диагностика." }] }),
  component: () => (
    <>
      <PageHeader title="Диагностика" back subtitle="Временный раздел, удалить перед релизом" />
      <div className="px-4 py-4">
        <Section>
          {["Окружение (YAMNet)", "Текущий источник звука", "Готовность модели Magenta RT", "Сбои вывода звука", "Время воспроизведения", "Температура / RAM / батарея"].map((t) => (
            <div key={t} className="flex min-h-14 items-center justify-between gap-3 border-b border-border/50 px-4 last:border-0">
              <span className="text-sm">{t}</span>
              <span className="text-right text-xs text-muted-foreground">Нет данных: модуль не подключён</span>
            </div>
          ))}
        </Section>
      </div>
    </>
  ),
});
