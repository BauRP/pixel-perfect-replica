import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The Android bundle downloads this heavy screen only when it is opened.
const LazyContent = lazy(() => import("@/components/sw/HistoryPage"));
function HistoryPage() {
  return <Suspense fallback={<div role="status" className="px-4 py-6 text-sm text-muted-foreground">Открываем раздел: История…</div>}>
    <LazyContent />
  </Suspense>;
}

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "История и избранное — SoundWorld AR" }, { name: "description", content: "Настоящие сохранённые фрагменты SoundWorld AR" }, { property: "og:title", content: "История и избранное — SoundWorld AR" }, { property: "og:description", content: "Настоящие сохранённые фрагменты SoundWorld AR" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: HistoryPage,
});

type LibraryData={last:ClipMeta[];fav:ClipMeta[];exp:ClipMeta[];journey:ClipMeta[]};
type Playback={state:"playing"|"paused"|"stopped"|"preparing";clipId:string};
function Empty({ icon:I,title,text }: {icon:typeof Clock;title:string;text:string}) {
  return <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
    <I className="size-8 text-muted-foreground"/>
    <p className="mt-3 font-semibold">{title}</p>
    <p className="mt-1 text-sm text-muted-foreground">{text}</p>
  </div>;
}

