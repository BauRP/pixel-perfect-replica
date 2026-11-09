import { ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { GENRES, ALL_SUBGENRE_IDS } from "@/lib/sw/catalog";
import { groupState } from "@/lib/sw/settings";
import { cn } from "@/lib/utils";
import { TriCheck } from "./ui";

export function GenrePicker({ selected, onChange }: { selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const visible = useMemo(
    () =>
      GENRES.map((g) => {
        if (!query) return { g, subs: g.subgenres, forceOpen: false };
        const groupHit = g.name.toLowerCase().includes(query);
        const subs = groupHit ? g.subgenres : g.subgenres.filter((s) => s.name.toLowerCase().includes(query));
        return { g, subs, forceOpen: subs.length > 0 };
      }).filter((x) => x.subs.length > 0),
    [query],
  );

  const toggleGroup = (gid: string) => {
    const g = GENRES.find((x) => x.id === gid)!;
    const next = new Set(selected);
    const st = groupState(gid, selected);
    for (const s of g.subgenres) st === "all" ? next.delete(s.id) : next.add(s.id);
    onChange(next);
  };
  const toggleSub = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск жанра"
          aria-label="Поиск жанра"
          className="h-11 w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-base outline-none focus:border-primary"
        />
        {q && (
          <button aria-label="Очистить поиск" onClick={() => setQ("")} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center text-muted-foreground">
            <X className="size-4" />
          </button>
        )}
      </label>
      <p className="px-1 text-xs text-muted-foreground">
        Выбрано {selected.size} из {ALL_SUBGENRE_IDS.length} поджанров · {GENRES.filter((g) => groupState(g.id, selected) === "all").length} из 15 групп целиком
      </p>
      <ul className="overflow-hidden rounded-2xl border border-border/70 bg-surface">
        {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Ничего не найдено</li>}
        {visible.map(({ g, subs, forceOpen }) => {
          const isOpen = forceOpen || !!open[g.id];
          const st = groupState(g.id, selected);
          const count = g.subgenres.filter((s) => selected.has(s.id)).length;
          return (
            <li key={g.id} className="border-b border-border/50 last:border-0">
              <div className="flex items-center pl-3">
                <button
                  className="flex min-h-12 flex-1 flex-col items-start justify-center text-left"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                >
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{count > 0 ? `${count} из 9` : "9 поджанров"}</span>
                </button>
                <TriCheck state={st} onToggle={() => toggleGroup(g.id)} label={`Выбрать весь жанр ${g.name}`} />
                <button
                  aria-label={isOpen ? `Свернуть ${g.name}` : `Развернуть ${g.name}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                  className="grid size-11 place-items-center text-muted-foreground"
                >
                  <ChevronDown className={cn("size-5 transition-transform", isOpen && "rotate-180")} />
                </button>
              </div>
              {isOpen && (
                <ul className="bg-background/40 pb-2">
                  {subs.map((s) => {
                    const on = selected.has(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 pl-8 pr-4">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleSub(s.id)}
                            className="size-5 shrink-0 accent-[var(--primary)]"
                          />
                          <span className={cn("text-sm", on ? "text-foreground" : "text-foreground/80")}>{s.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
