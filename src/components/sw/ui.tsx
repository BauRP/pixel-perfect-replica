import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Check, Minus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function PageHeader({ title, back, right, subtitle }: { title: string; back?: boolean; right?: ReactNode; subtitle?: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 pt-safe backdrop-blur-md">
      <div className="flex min-h-12 items-center gap-2 px-3 pb-1">
        {back && (
          <button
            aria-label="Назад"
            onClick={() => router.history.back()}
            className="-ml-2 grid size-11 place-items-center rounded-full text-foreground hover:bg-secondary"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

/** Simple touch-friendly help popup. Avoid unsupported color-mix
 * translucent-blue utility backgrounds on older Android WebViews, and avoid
 * the many pointer/focus/portal handlers of a third-party Popover on Studio.
 * No app feature is changed; the same eleven explanations are preserved.
 */
export function HelpDot({ title, text }: { title: string; text: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const visible = position !== null;

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger.current?.contains(target) || popup.current?.contains(target)) return;
      setPosition(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosition(null);
        trigger.current?.focus();
      }
    };
    const dismissOnScroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      setPosition(null);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissOnScroll);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnScroll);
    };
  }, [visible]);

  const toggle = () => {
    if (visible) {
      setPosition(null);
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = Math.max(window.innerWidth, 240);
    const viewportHeight = Math.max(window.innerHeight, 240);
    const width = Math.min(272, viewportWidth - 24);
    const left = Math.min(Math.max(12, rect.right - width), viewportWidth - width - 12);
    const estimatedHeight = 148;
    const showAbove = rect.bottom + estimatedHeight + 8 > viewportHeight && rect.top > estimatedHeight + 12;
    const top = showAbove
      ? Math.max(12, rect.top - estimatedHeight - 8)
      : Math.max(12, Math.min(rect.bottom + 8, viewportHeight - estimatedHeight - 12));
    setPosition({ left, top, width });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Что такое «${title}»?`}
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        onClick={toggle}
        className="sw-help-trigger"
        style={{
          width: 44, height: 44, padding: 0, border: 0, outlineOffset: 2,
          appearance: "none", background: "transparent", color: "#ffffff",
          display: "grid", placeItems: "center", flexShrink: 0, cursor: "pointer",
        }}
      >
        <span aria-hidden="true" className="sw-help-mark"
          style={{
            width: 26, height: 26, display: "grid", placeItems: "center",
            border: "1.5px solid #ffffff", borderRadius: "50%",
            background: "transparent", color: "#ffffff",
            fontFamily: "Arial, sans-serif", fontSize: 17, fontWeight: 700,
            lineHeight: 1,
          }}>?</span>
      </button>
      {visible && position && typeof document !== "undefined" && createPortal(
        <div
          ref={popup}
          id={id}
          role="dialog"
          aria-modal="false"
          aria-label={title}
          className="sw-help-popup"
          style={{
            position: "fixed", zIndex: 9999,
            left: position.left, top: position.top, width: position.width,
            maxHeight: "calc(100vh - 24px)", overflowY: "auto",
            boxSizing: "border-box", padding: "12px 14px",
            border: "1px solid #50637a", borderRadius: 14,
            background: "#132235", color: "#f6f8ff",
            boxShadow: "0 12px 30px rgba(0,0,0,0.65)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <strong className="text-sm font-semibold">{title}</strong>
            <button type="button" aria-label="Закрыть подсказку"
              onClick={() => setPosition(null)}
              style={{
                width: 26, height: 26, flexShrink: 0, fontSize: 18,
                lineHeight: 1, color: "#ffffff", border: 0,
                background: "transparent", cursor: "pointer",
              }}>×</button>
          </div>
          <p className="mt-1 text-xs leading-relaxed" style={{color:"#e1eaf5"}}>{text}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {title && <h2 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface shadow-card">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-1 rounded-xl bg-background/60 p-1", options.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-11 min-w-0 rounded-lg px-1.5 py-1 text-xs font-medium leading-tight transition-colors",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function TriCheck({
  state, onToggle, label,
}: { state: "none" | "partial" | "all"; onToggle: () => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={state === "all" ? true : state === "partial" ? "mixed" : false}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="grid size-11 shrink-0 place-items-center"
    >
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full border-2 transition-colors",
          state === "none" && "border-check-idle text-check-idle",
          state === "all" && "border-primary bg-primary text-primary-foreground",
          state === "partial" && "border-primary text-primary",
        )}
      >
        {state === "partial" ? <Minus className="size-4" strokeWidth={3} /> : <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function NavRow({ to, title, value, icon }: { to: string; title: string; value?: string; icon?: ReactNode }) {
  return (
    <Link
      to={to as "/"}
      className="flex min-h-11 items-center gap-2 border-b border-border/50 px-3 py-1.5 last:border-0 hover:bg-secondary/60"
    >
      {icon && <span className="text-primary">{icon}</span>}
      <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{title}</span>
      {value && <span className="max-w-[43%] truncate text-xs text-muted-foreground">{value}</span>}
      <span aria-hidden className="text-muted-foreground">›</span>
    </Link>
  );
}

export function PendingBadge({ children = "Ожидает подключения" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
      <span className="size-1.5 rounded-full bg-warning" /> {children}
    </span>
  );
}
