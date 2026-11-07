import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sw/ui";

export const Route = createFileRoute("/settings/about")({
  head: () => ({ meta: [{ title: "Лицензии и приватность — SoundWorld AR" }, { name: "description", content: "Лицензии и политика приватности." }, { property: "og:title", content: "Лицензии и приватность" }, { property: "og:description", content: "Лицензии и приватность." }] }),
  component: () => (
    <>
      <PageHeader title="Лицензии и приватность" back />
      <div className="space-y-5 px-4 py-4 text-sm">
        <Section title="Приватность">
          <ul className="list-disc space-y-2 py-3 pl-8 pr-4 text-foreground/90">
            <li>Приложение работает без интернета; звук не отправляется на серверы.</li>
            <li>Разговоры людей не записываются и не сохраняются.</li>
            <li>Геолокация не используется.</li>
            <li>Настройки хранятся только на этом устройстве.</li>
          </ul>
        </Section>
        <Section title="Компоненты">
          <ul className="space-y-2 px-4 py-3 text-foreground/90">
            <li>Google Magenta RealTime 2 Small — планируется, ещё не встроен</li>
            <li>Google YAMNet — планируется, ещё не встроен</li>
            <li>React, TanStack, Radix UI, Lucide — MIT</li>
            <li>Шрифты Unbounded, Manrope — SIL OFL</li>
          </ul>
        </Section>
      </div>
    </>
  ),
});
