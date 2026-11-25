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

