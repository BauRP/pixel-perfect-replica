import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GenrePicker } from "@/components/sw/GenrePicker";
import { Button } from "@/components/ui/button";
import { applySkipAllGenres, updateSettings, useSettings } from "@/lib/sw/settings";
import { ALL_SUBGENRE_IDS } from "@/lib/sw/catalog";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Музыкальные вкусы — SoundWorld AR" },
      { name: "description", content: "Выберите любимые жанры для адаптивной музыки SoundWorld AR." },
      { property: "og:title", content: "Музыкальные вкусы — SoundWorld AR" },
      { property: "og:description", content: "Выберите любимые жанры." },
    ],
  }),
  component: Onboarding,
});

function Onboarding() {
  const s = useSettings();
  const navigate = useNavigate();
  const [sel, setSel] = useState(() => new Set(s.allowedAllGenres ? ALL_SUBGENRE_IDS : s.chosenGenreIds));

  const skip = () => {
    updateSettings(applySkipAllGenres);
    navigate({ to: "/", replace: true });
  };
  const next = () => {
    updateSettings((x) => ({
      ...x,
      chosenGenreIds: [...sel],
      allowedAllGenres: sel.size === ALL_SUBGENRE_IDS.length,
      onboardingCompleted: true,
    }));
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe px-5 pb-4">
        <div className="flex items-center justify-between pt-3">
          <span className="font-display text-[11px] tracking-[0.3em] text-muted-foreground">SOUNDWORLD AR</span>
          <button onClick={skip} className="min-h-12 px-2 text-sm font-semibold text-primary">Пропустить</button>
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Музыкальные вкусы</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Отметьте, что вам нравится. «Пропустить» — значит, нравятся все жанры. Выбор можно изменить позже в Studio.
        </p>
      </header>
      <div className="flex-1 px-4 pb-32">
        <GenrePicker selected={sel} onChange={setSel} />
      </div>
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-border/60 bg-background/95 px-4 pt-3 pb-safe backdrop-blur-md">
        <Button size="lg" className="mb-2 h-12 w-full rounded-xl text-base" disabled={sel.size === 0} onClick={next}>
          {sel.size === 0 ? "Выберите хотя бы один жанр" : `Продолжить · ${sel.size}`}
        </Button>
      </div>
    </div>
  );
}
