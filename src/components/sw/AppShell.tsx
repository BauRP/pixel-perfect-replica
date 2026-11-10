import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Disc3, SlidersHorizontal, Settings2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { hydrateSettings, useSettings, useSettingsHydrated } from "@/lib/sw/settings";
import { getAdapters } from "@/lib/sw/engine";
import { cn } from "@/lib/utils";

/** EXACTLY three destinations, fixed order and labels. */
export const TABS = [
  { to: "/", label: "Плеер", icon: Disc3 },
  { to: "/studio", label: "Студия", icon: SlidersHorizontal },
  { to: "/settings", label: "Настройки", icon: Settings2 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useSettingsHydrated();
  const settings = useSettings();
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => hydrateSettings(), []);
  useEffect(() => {
    if (hydrated) void getAdapters().performance.applyBatteryMode(settings.batteryMode);
  }, [hydrated, settings.batteryMode]);
  useEffect(() => {
    if (hydrated && !settings.onboardingCompleted && loc.pathname !== "/onboarding") {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [hydrated, settings.onboardingCompleted, loc.pathname, navigate]);

  useEffect(() => {
    // Delay the Android smoke-test marker until the new route's children have
    // committed. The old immediate log captured path "/" with the previous
    // onboarding <h1> during route transitions.
    const timer = window.setTimeout(() => {
      const nav = document.querySelector(".sw-bottom-nav");
      const shell = document.querySelector(".sw-shell");
      const root = document.getElementById("root");
      const rect = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      };
      console.info("SW_NAV_GEOMETRY", JSON.stringify({
        path: loc.pathname, completed: settings.onboardingCompleted,
        nav: rect(nav), shell: rect(shell), root: rect(root),
        vh: window.innerHeight, vw: window.innerWidth,
        dpr: window.devicePixelRatio,
        heading: document.querySelector("h1")?.textContent?.trim() ?? "",
        tabs: Array.from(document.querySelectorAll(".sw-tab-link")).map(el => el.textContent?.trim() ?? ""),
      }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loc.pathname, settings.onboardingCompleted]);

  if (!hydrated) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <span className="font-display text-sm tracking-[0.3em] text-muted-foreground">SOUNDWORLD AR</span>
      </div>
    );
  }

  // On first-run, onboarding hides the tabs. As soon as the user completes
  // or skips their genre selection, display tabs immediately even if the
  // router is still committing its navigation from /onboarding to /.
  const onboarding = loc.pathname === "/onboarding" && !settings.onboardingCompleted;
  const showTabs = settings.onboardingCompleted;
  const activeTab = loc.pathname === "/" || loc.pathname.startsWith("/history")
    ? "/"
    : loc.pathname.startsWith("/studio") ? "/studio" : loc.pathname.startsWith("/settings") ? "/settings" : "";

  return (
    <div className="sw-shell mx-auto flex h-full min-h-0 w-full min-w-0 max-w-md flex-col overflow-hidden bg-background bg-page-glow md:max-w-2xl">
      <main className={cn("sw-main min-h-0 min-w-0 flex-1", onboarding ? "overflow-hidden" : "overflow-y-auto overscroll-contain")}>{children}</main>
      {showTabs && (
        <nav
          aria-label="Основная навигация"
          className="sw-bottom-nav z-30 w-full shrink-0 border-t border-border/60 bg-background/95 pb-safe backdrop-blur-md"
        >
          <ul className="grid grid-cols-3">
            {TABS.map((t) => {
              const on = activeTab === t.to;
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    onClick={() => console.info("SW_NAV_CLICK", t.label, "from", loc.pathname)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "sw-tab-link flex min-h-13 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                      on ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className={cn("sw-tab-icon grid h-7 w-12 place-items-center rounded-full", on && "bg-primary/15")}>
                      <t.icon className="size-[18px]" />
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
