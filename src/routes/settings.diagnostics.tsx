import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The Android bundle downloads this heavy screen only when it is opened.
const LazyContent = lazy(() => import("@/components/sw/DiagnosticsPage"));
function Diagnostics() {
  return <Suspense fallback={<div role="status" className="px-4 py-6 text-sm text-muted-foreground">Открываем раздел: Диагностика…</div>}>
    <LazyContent />
  </Suspense>;
}

export const Route = createFileRoute("/settings/diagnostics")({
  head: () => ({ meta: [{ title: "Диагностика — SoundWorld AR" }, { name: "description", content: "Проверка настоящих датчиков и аудиовыхода SoundWorld AR." }, { property: "og:title", content: "Диагностика — SoundWorld AR" }, { property: "og:description", content: "Проверка настоящих датчиков и аудиовыхода SoundWorld AR." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: Diagnostics
});

