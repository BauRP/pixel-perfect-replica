import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GenrePicker } from "@/components/sw/GenrePicker";
import { PageHeader } from "@/components/sw/ui";
import { ALL_SUBGENRE_IDS } from "@/lib/sw/catalog";
import { updateSettings, useSettings } from "@/lib/sw/settings";
import { notify } from "@/lib/sw/notify";

export const Route = createFileRoute("/studio/tastes")({
  head: () => ({ meta: [{ title: "Музыкальные вкусы — Studio" }, { name: "description", content: "Изменить любимые жанры." }, { property: "og:title", content: "Музыкальные вкусы" }, { property: "og:description", content: "Изменить любимые жанры." }] }),
  component: Tastes,
});

function Tastes() {
  const s = useSettings();
  const [sel, setSel] = useState(() => new Set(s.allowedAllGenres ? ALL_SUBGENRE_IDS : s.chosenGenreIds));
  const change = (next: Set<string>) => {
    if (next.size === 0) { notify.error("Нужен хотя бы один жанр"); return; }
    setSel(next);
    updateSettings((x) => ({ ...x, chosenGenreIds: [...next], allowedAllGenres: next.size === ALL_SUBGENRE_IDS.length }));
  };
  return (
    <>
      <PageHeader title="Музыкальные вкусы" back subtitle="Сохраняется автоматически" />
      <div className="px-4 py-4"><GenrePicker selected={sel} onChange={change} /></div>
    </>
  );
}
