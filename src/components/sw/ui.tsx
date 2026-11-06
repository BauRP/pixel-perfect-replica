import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Check, Minus, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PageHeader({ title, back, right, subtitle }: { title: string; back?: boolean; right?: ReactNode; subtitle?: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 pt-safe backdrop-blur-md">
      <div className="flex min-h-14 items-center gap-2 px-4 pb-2">
        {back && (
          <button
            aria-label="Назад"
            onClick={() => router.history.back()}
            className="-ml-2 grid size-12 place-items-center rounded-full text-foreground hover:bg-secondary"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function HelpDot({ title, text }: { title: string; text: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          aria-label={`Что такое «${title}»?`}
          className="grid size-12 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <span className="grid size-6 place-items-center rounded-full border border-current text-xs font-bold">?</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-base">
            <HelpCircle className="size-5 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-foreground/90">{text}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      {title && <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-card">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-background/60 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-12 flex-1 basis-[30%] rounded-lg px-2 text-sm font-medium transition-colors",
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
      className="grid size-12 shrink-0 place-items-center"
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full border-2 transition-colors",
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
      className="flex min-h-14 items-center gap-3 border-b border-border/50 px-4 py-3 last:border-0 hover:bg-secondary/60"
    >
      {icon && <span className="text-primary">{icon}</span>}
      <span className="flex-1 font-medium">{title}</span>
      {value && <span className="max-w-[45%] truncate text-sm text-muted-foreground">{value}</span>}
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
