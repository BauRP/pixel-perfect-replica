import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Disc3, SlidersHorizontal, Settings2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { hydrateSettings, useSettings, useSettingsHydrated } from "@/lib/sw/settings";
import { cn } from "@/lib/utils";

/** EXACTLY three destinations, fixed order and labels. */
export const TABS = [
  { to: "/", label: "Player", icon: Disc3 },
  { to: "/studio", label: "Studio", icon: SlidersHorizontal },
  { to: "/settings", label: "Настройки", icon: Settings2 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useSettingsHydrated();
  const settings = useSettings();
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => hydrateSettings(), []);
  useEffect(() => {
    if (hydrated && !settings.onboardingCompleted && loc.pathname !== "/onboarding") {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [hydrated, settings.onboardingCompleted, loc.pathname, navigate]);

  if (!hydrated) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <span className="font-display text-sm tracking-[0.3em] text-muted-foreground">SOUNDWORLD AR</span>
      </div>
    );
  }

  const onboarding = loc.pathname === "/onboarding";
  const activeTab = loc.pathname === "/" || loc.pathname.startsWith("/history")
    ? "/"
    : loc.pathname.startsWith("/studio") ? "/studio" : loc.pathname.startsWith("/settings") ? "/settings" : "";

  return (
    <div className="sw-shell mx-auto flex min-h-dvh w-full min-w-0 max-w-md flex-col bg-background bg-page-glow md:max-w-2xl">
      <main className={cn("sw-main min-w-0 flex-1", !onboarding && "pb-[calc(6rem+env(safe-area-inset-bottom))]")}>{children}</main>
      {!onboarding && (
        <nav
          aria-label="Основная навигация"
          className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t border-border/60 bg-background/95 pb-safe backdrop-blur-md md:max-w-2xl"
        >
          <ul className="grid grid-cols-3">
            {TABS.map((t) => {
              const on = activeTab === t.to;
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "sw-tab-link flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors",
                      on ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className={cn("sw-tab-icon grid h-8 w-14 place-items-center rounded-full", on && "bg-primary/15")}>
                      <t.icon className="size-5" />
                    </span>
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
