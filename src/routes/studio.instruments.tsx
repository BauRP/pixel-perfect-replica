import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { PageHeader, Section } from "@/components/sw/ui";
import { INSTRUMENTS, capitalize } from "@/lib/sw/catalog";
import { toggleFavoriteInstrument, updateSettings, useSettings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/studio/instruments")({
  head: () => ({ meta: [{ title: "Любимые инструменты — Studio" }, { name: "description", content: "Выбор любимых инструментов." }, { property: "og:title", content: "Любимые инструменты" }, { property: "og:description", content: "Выбор любимых инструментов." }] }),
  component: Instruments,
});

function Instruments() {
  const s = useSettings();
  const toggle = (id: string) => {
    const r = toggleFavoriteInstrument(s, id);
    if (r.conflict) return notify.error("Этот инструмент исключён в пункте 4 — сначала снимите исключение");
    updateSettings(() => r.next);
  };
  return (
    <>
      <PageHeader title="Любимые инструменты" back subtitle={s.favoriteInstrumentIds.length ? `Выбрано: ${s.favoriteInstrumentIds.length}` : "По умолчанию — выбирает музыка"} />
      <div className="space-y-5 px-4 py-4">
        {s.favoriteInstrumentIds.length > 0 && (
          <button onClick={() => updateSettings((x) => ({ ...x, favoriteInstrumentIds: [] }))} className="min-h-12 text-sm font-semibold text-primary">Сбросить выбор</button>
        )}
        {INSTRUMENTS.map((c) => (
          <Section key={c.id} title={c.name}>
            <div className="flex flex-wrap gap-2 p-3">
              {c.items.map((i) => {
                const on = s.favoriteInstrumentIds.includes(i.id);
                const excluded = s.dislikes[i.id] === "excluded";
                return (
                  <button key={i.id} aria-pressed={on} onClick={() => toggle(i.id)}
                    className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/40",
                      excluded && "line-through opacity-50")}>
                    {on && <Check className="size-4" />} {capitalize(i.name)}
                  </button>
                );
              })}
            </div>
          </Section>
        ))}
      </div>
    </>
  );
}
