import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Heart, FolderDown, Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/sw/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAdapters, type ClipMeta } from "@/lib/sw/engine";
import { genreNameById } from "@/lib/sw/catalog";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "История и избранное — SoundWorld AR" }, { name: "description", content: "Последние фрагменты, избранное и сохранённое." }, { property: "og:title", content: "История и избранное" }, { property: "og:description", content: "Последние фрагменты, избранное и сохранённое." }] }),
  component: HistoryPage,
});

function Empty({ icon: I, title, text }: { icon: typeof Clock; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <I className="size-8 text-muted-foreground" />
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ClipList({ items }: { items: ClipMeta[] }) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li key={c.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
          {new Date(c.createdAt).toLocaleString("ru")} · {Math.round(c.durationSec)} с · {c.genreIds.map((g) => genreNameById[g]).join(", ")}
        </li>
      ))}
    </ul>
  );
}

function HistoryPage() {
  const [data, setData] = useState<{ last: ClipMeta[]; fav: ClipMeta[]; exp: ClipMeta[] }>({ last: [], fav: [], exp: [] });
  useEffect(() => {
    const lib = getAdapters().library;
    Promise.all([lib.listLastThreeCompleted(), lib.listFavorites(), lib.listExports()]).then(([a, b, c]) =>
      setData({ last: a.ok ? a.value : [], fav: b.ok ? b.value : [], exp: c.ok ? c.value : [] }),
    );
  }, []);
  return (
    <>
      <PageHeader title="История и избранное" back />
      <div className="px-4 py-4">
        <Tabs defaultValue="last">
          <TabsList className="grid h-12 w-full grid-cols-4">
            <TabsTrigger value="last">Последние 3</TabsTrigger>
            <TabsTrigger value="fav">Избранное</TabsTrigger>
            <TabsTrigger value="exp">Сохранённое</TabsTrigger>
            <TabsTrigger value="trip">Путешествие</TabsTrigger>
          </TabsList>
          <TabsContent value="last" className="pt-4">
            {data.last.length ? <ClipList items={data.last} /> : <Empty icon={Clock} title="Пока пусто" text="Здесь появятся три последних завершённых 120-секундных фрагмента." />}
          </TabsContent>
          <TabsContent value="fav" className="pt-4">
            {data.fav.length ? <ClipList items={data.fav} /> : <Empty icon={Heart} title="Нет избранного" text="Нажмите сердце в Player, когда будет звучать живая музыка." />}
          </TabsContent>
          <TabsContent value="exp" className="pt-4">
            {data.exp.length ? <ClipList items={data.exp} /> : <Empty icon={FolderDown} title="Ничего не сохранено" text="Файлы, реально сохранённые на телефон, появятся здесь." />}
          </TabsContent>
          <TabsContent value="trip" className="pt-4">
            <Empty icon={RouteIcon} title="История музыкального путешествия" text="Последовательность атмосфер прогулки. Без GPS и без записи разговоров. Пока данных нет." />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
