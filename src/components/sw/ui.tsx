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
/** Small help dialog compatible with legacy Android WebViews / MuMu.
 * The previous floating popup was dismissed by incidental scroll events
 * while calculating viewport placement. A compact centered portal avoids
 * scroll clipping and does not affect music settings or controls.
 */
export function HelpDot({ title, text }: { title: string; text: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const lastTouchAt = useRef(-Infinity);
  const touchStart = useRef<{x:number;y:number}|null>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus({preventScroll:true});
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => setOpen(value => !value);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Что такое «${title}»?`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          // Touch WebViews may dispatch a compatibility click right after
          // touchend. A duplicate must not immediately close the dialog.
          if (Date.now() - lastTouchAt.current < 700) return;
          toggle();
        }}
        onTouchStart={event => {
          const t=event.touches[0];
          touchStart.current=t?{x:t.clientX,y:t.clientY}:null;
        }}
        onTouchEnd={event => {
          const initial=touchStart.current;
          const t=event.changedTouches[0];
          touchStart.current=null;
          if(!initial || !t || Math.abs(t.clientX-initial.x)>14 ||
             Math.abs(t.clientY-initial.y)>14) return;
          lastTouchAt.current=Date.now();
          toggle();
        }}
        className="sw-help-trigger"
        style={{
          width:44,height:44,padding:0,border:0,outlineOffset:2,
          appearance:"none",background:"transparent",color:"#ffffff",
          display:"grid",placeItems:"center",flexShrink:0,cursor:"pointer",
          touchAction:"manipulation",
        }}
      >
        <span aria-hidden="true" className="sw-help-mark"
          style={{
            width:22,height:22,display:"grid",placeItems:"center",
            border:"1.5px solid #ffffff",borderRadius:"50%",
            background:"transparent",color:"#ffffff",
            fontFamily:"Arial, sans-serif",fontSize:15,fontWeight:600,lineHeight:1,
          }}>?</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          data-testid="sw-help-overlay"
          onClick={event => {if(event.target===event.currentTarget)close();}}
          style={{
            position:"fixed",inset:0,zIndex:2147483000,
            display:"flex",alignItems:"center",justifyContent:"center",
            padding:"20px",boxSizing:"border-box",
            background:"rgba(0,0,0,0.56)",
          }}
        >
          <div
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="sw-help-popup"
            style={{
              boxSizing:"border-box",width:"100%",maxWidth:310,
              maxHeight:"calc(100vh - 40px)",overflowY:"auto",
              padding:"15px 16px 16px",borderRadius:16,
              border:"1px solid #395d77",background:"#122235",color:"#f6f8ff",
              boxShadow:"0 18px 46px rgba(0,0,0,0.8), 0 0 20px rgba(45,166,250,0.1)",
            }}
          >
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span aria-hidden="true"
                style={{
                  display:"grid",placeItems:"center",flexShrink:0,
                  width:20,height:20,border:"1px solid #d4e8fa",
                  color:"#ffffff",borderRadius:"50%",fontSize:13,
                  fontWeight:600,lineHeight:1,
                }}>?</span>
              <strong style={{fontSize:14,lineHeight:1.35,flex:1}}>{title}</strong>
              <button type="button" aria-label="Закрыть подсказку"
                onClick={close}
                style={{
                  width:36,height:36,flexShrink:0,display:"grid",placeItems:"center",
                  padding:0,border:0,borderRadius:8,
                  background:"transparent",color:"#e8f1ff",fontSize:23,
                  cursor:"pointer",
                }}>×</button>
            </div>
            <p style={{
              margin:"9px 0 0",color:"#dbe5f2",
              fontSize:12.5,lineHeight:1.55,whiteSpace:"normal",
            }}>{text}</p>
            <p style={{
              margin:"10px 0 0",paddingTop:8,borderTop:"1px solid #29435b",
              color:"#9eafc2",fontSize:10.5,lineHeight:1.4,
            }}>Настройки сохраняются. Новая музыка заработает после подключения движка.</p>
          </div>
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
