import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The Android bundle downloads this heavy screen only when it is opened.
const LazyContent = lazy(() => import("@/components/sw/DislikesPage"));
function Dislikes() {
  return <Suspense fallback={<div role="status" className="px-4 py-6 text-sm text-muted-foreground">Открываем раздел: Ограничения…</div>}>
    <LazyContent />
  </Suspense>;
}

export const Route = createFileRoute("/studio/dislikes")({
  head: () => ({ meta: [{ title: "Нелюбимые инструменты и жанры — Studio" }, { name: "description", content: "Ограничения жанров и инструментов." }, { property: "og:title", content: "Нелюбимые инструменты и жанры" }, { property: "og:description", content: "Ограничения." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: Dislikes,
});

