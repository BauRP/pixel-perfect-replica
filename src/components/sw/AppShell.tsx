import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Disc3, SlidersHorizontal, Settings2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { hydrateSettings, useSettings, useSettingsHydrated } from "@/lib/sw/settings";
import { getAdapters } from "@/lib/sw/engine";
import { stopSensorDiagnostics } from "@/lib/sw/native-sensors";
import { installFreezeMonitoring, traceFreezeScreen } from "@/lib/sw/freeze-report";
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
  // Low-cost diagnostic heartbeat, only while Android app is visible.
  useEffect(() => installFreezeMonitoring(), []);
  useEffect(() => {traceFreezeScreen(loc.pathname);}, [loc.pathname]);
  useEffect(() => {
    if (hydrated) void getAdapters().performance.applyBatteryMode(settings.batteryMode);
  }, [hydrated, settings.batteryMode]);
  useEffect(() => {
    // Opting out of environment analysis is an immediate privacy action,
    // not merely a cosmetic flag hiding existing microphone readings.
    // Stop both the microphone/YAMNet and step-detection native resources.
    if (hydrated && settings.musicOnlyMode) {
      void stopSensorDiagnostics();
    }
  }, [hydrated, settings.musicOnlyMode]);
  useEffect(() => {
    // Re-apply the user's actual route choice on app launch AND while the
    // microphone is already active. No capture is opened by this call.
    if (hydrated) void getAdapters().router.chooseBestSupportedRoute();
  }, [hydrated, settings.autoAudioRouting, settings.microphonePreference]);
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
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
      };
      console.info("SW_NAV_GEOMETRY", JSON.stringify({
        path: loc.pathname, completed: settings.onboardingCompleted,
        nav: rect(nav), shell: rect(shell), root: rect(root),
        onboardingSkip: rect(document.querySelector('[data-sw-action="onboarding-skip"]')),
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
                      "sw-tab-link relative flex min-h-13 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                      on ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span aria-hidden="true" className={cn(
                      "absolute left-1/2 top-0 h-[2px] w-9 -translate-x-1/2 rounded-full transition-opacity",
                      on ? "bg-primary opacity-100 shadow-[0_0_10px_rgba(45,166,250,0.85)]" : "opacity-0",
                    )} />
                    <span className="sw-tab-icon grid h-7 w-12 place-items-center">
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
