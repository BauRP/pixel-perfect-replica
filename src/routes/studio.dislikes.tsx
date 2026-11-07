import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sw/ui";
import { GENRES, INSTRUMENTS, capitalize } from "@/lib/sw/catalog";
import { setDislike, updateSettings, useSettings, type DislikeLevel } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/studio/dislikes")({
  head: () => ({ meta: [{ title: "Нелюбимые инструменты и жанры — Studio" }, { name: "description", content: "Ограничения жанров и инструментов." }, { property: "og:title", content: "Нелюбимые инструменты и жанры" }, { property: "og:description", content: "Ограничения." }] }),
  component: Dislikes,
});

function Row({ id, name }: { id: string; name: string }) {
  const s = useSettings();
  const cur = s.dislikes[id];
  const pick = (lvl: DislikeLevel) => {
    const next = cur === lvl ? null : lvl;
    if (next === "excluded" && s.favoriteInstrumentIds.includes(id)) notify.queued(`«${capitalize(name)}» убран из любимых: исключение важнее`);
    updateSettings((x) => setDislike(x, id, next));
  };
  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2 last:border-0">
      <span className="flex-1 text-sm">{capitalize(name)}</span>
      {(["notPreferred", "excluded"] as const).map((l) => (
        <button key={l} aria-pressed={cur === l} onClick={() => pick(l)}
          className={cn("min-h-11 rounded-lg px-2.5 text-xs font-semibold",
            cur === l ? (l === "excluded" ? "bg-destructive text-destructive-foreground" : "bg-warning text-primary-foreground") : "bg-background/50 text-muted-foreground")}>
          {l === "excluded" ? "Исключить" : "Не предпочитаю"}
        </button>
      ))}
    </div>
  );
}

function Dislikes() {
  const s = useSettings();
  const n = Object.keys(s.dislikes).length;
  return (
    <>
      <PageHeader title="Нелюбимое" back subtitle={n ? `Ограничений: ${n}` : "По умолчанию — без ограничений"} />
      <div className="space-y-5 px-4 py-4">
        {n > 0 && <button onClick={() => updateSettings((x) => ({ ...x, dislikes: {} }))} className="min-h-12 text-sm font-semibold text-primary">Снять все ограничения</button>}
        <h2 className="px-1 text-sm font-semibold">Инструменты</h2>
        {INSTRUMENTS.map((c) => (
          <Section key={c.id} title={c.name}>{c.items.map((i) => <Row key={i.id} id={i.id} name={i.name} />)}</Section>
        ))}
        <h2 className="px-1 pt-2 text-sm font-semibold">Жанры</h2>
        {GENRES.map((g) => (
          <Section key={g.id} title={g.name}>{g.subgenres.map((x) => <Row key={x.id} id={x.id} name={x.name} />)}</Section>
        ))}
      </div>
    </>
  );
}
