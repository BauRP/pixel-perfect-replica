import { memo, useSyncExternalStore } from "react";
import { PageHeader, Section } from "@/components/sw/ui";
import { GENRES, INSTRUMENTS, capitalize } from "@/lib/sw/catalog";
import { setDislike, updateSettings, useSettings, getSettingsSnapshot, subscribeSettings, type DislikeLevel } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";
import { cn } from "@/lib/utils";

const Row=memo(function Row({ id, name }: { id: string; name: string }) {
  // Only this item's selected state triggers its own component re-render.
  const cur=useSyncExternalStore(subscribeSettings,
    () => getSettingsSnapshot().dislikes[id] ?? null, () => null);
  const pick = (lvl: DislikeLevel) => {
    const next = cur === lvl ? null : lvl;
    if (next === "excluded" && getSettingsSnapshot().favoriteInstrumentIds.includes(id)) notify.queued(`«${capitalize(name)}» убран из любимых: исключение важнее`);
    updateSettings((x) => setDislike(x, id, next));
  };
  return (
    <div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 py-1.5 last:border-0">
      <span className="min-w-0 flex-1 text-xs leading-snug">{capitalize(name)}</span>
      {(["notPreferred", "excluded"] as const).map((l) => (
        <button key={l} aria-pressed={cur === l} onClick={() => pick(l)}
          className={cn("min-h-11 shrink-0 rounded-lg px-1.5 text-[10px] font-semibold leading-tight",
            cur === l ? (l === "excluded" ? "bg-destructive text-destructive-foreground" : "bg-warning text-primary-foreground") : "bg-background/50 text-muted-foreground")}>
          {l === "excluded" ? "Исключить" : "Не предпочитаю"}
        </button>
      ))}
    </div>
  );
});

export default function Dislikes() {
  const s = useSettings();
  const n = Object.keys(s.dislikes).length;
  return (
    <>
      <PageHeader title="Нелюбимое" back subtitle={n ? `Ограничений: ${n}` : "По умолчанию — без ограничений"} />
      <div className="space-y-3 px-3 py-3">
        {n > 0 && <button onClick={() => updateSettings((x) => ({ ...x, dislikes: {} }))} className="min-h-12 text-sm font-semibold text-primary">Снять все ограничения</button>}
        <h2 className="px-1 text-sm font-semibold">Инструменты</h2>
        {INSTRUMENTS.map((c) => (
          <Section key={c.id} title={c.name}>{c.items.map((i) => <Row key={i.id} id={i.id} name={i.name} />)}</Section>
        ))}
        <h2 className="px-1 pt-1 text-sm font-semibold">Жанры</h2>
        <p className="px-1 text-xs text-muted-foreground">Исключение целого жанра запрещает все его поджанры, даже если они ранее выбраны в музыкальных вкусах.</p>
        {GENRES.map((g) => (
          <Section key={g.id} title={g.name}>
            <Row id={g.id} name={"Весь жанр: "+g.name}/>
            {g.subgenres.map((x) => <Row key={x.id} id={x.id} name={x.name} />)}
          </Section>
        ))}
      </div>
    </>
  );
}
