import { createFileRoute } from "@tanstack/react-router";
import { Lock, Music4, Wand2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { HelpDot, NavRow, PageHeader, Section, Segmented } from "@/components/sw/ui";
import { Slider } from "@/components/ui/slider";
import { updateSettings, useSettings, effectiveDirections, type Settings } from "@/lib/sw/settings";
import {effectivePreferences} from "@/lib/sw/effective-preferences";

export const Route = createFileRoute("/studio/")({
  head: () => ({
    meta: [
      { title: "Studio — SoundWorld AR" },
      { name: "description", content: "Одиннадцать музыкальных настроек SoundWorld AR." },
      { property: "og:title", content: "Studio — SoundWorld AR" },
      { property: "og:description", content: "Музыкальные настройки." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings((s) => ({ ...s, [k]: v }));
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

function Item({ n, title, help, children, value }: { n: number; title: string; help: string; children: ReactNode; value?: string }) {
  return (
    <div className="border-b border-border/50 px-3 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className="sw-studio-step grid size-6 shrink-0 place-items-center rounded-full font-display text-xs" style={{background:"rgba(45,166,250,0.18)",border:"1px solid #2da6fa",color:"#ffffff"}}>{n}</span>
        <h3 className="min-w-0 flex-1 font-sans text-[13px] font-semibold leading-snug">{title}</h3>
        {value && <span className="max-w-[35%] truncate text-xs text-muted-foreground">{value}</span>}
        <HelpDot title={title} text={help} />
      </div>
      <div className="pt-1">{children}</div>
    </div>
  );
}

const MOOD_WORD = (m: number) => (m < 0 ? "Грустная" : m > 0 ? "Весёлая" : "Нейтральная");
const SPEED_WORD = (v: number) => (v < 0 ? "Медленнее" : v > 0 ? "Быстрее" : "Средняя");

function Studio() {
  const s = useSettings();
  // Dragging a slider updates its visible value immediately, but writes to
  // WebView localStorage only when the gesture finishes. This prevents a
  // synchronous storage write and whole-app redraw on every drag pixel.
  const [moodDraft,setMoodDraft]=useState(s.mood);
  const [speedDraft,setSpeedDraft]=useState(s.speed);
  useEffect(()=>setMoodDraft(s.mood),[s.mood]);
  useEffect(()=>setSpeedDraft(s.speed),[s.speed]);
  const favCount = s.favoriteInstrumentIds.length;
  const disCount = Object.keys(s.dislikes).length;
  const dirs = effectiveDirections(s).length;
  const resolved=effectivePreferences(s);

  return (
    <>
      <PageHeader title="Студия" subtitle="Настройки музыки" />
      <div className="space-y-3 px-3 py-3">
        <Section>
          <NavRow to="/studio/tastes" title="Музыкальные вкусы" value={s.allowedAllGenres ? "Все жанры" : `${dirs} направлений`} icon={<Music4 className="size-5" />} />
        </Section>

        <Section>
          <Item n={1} title="Настроение" value={`${sign(moodDraft)} · ${MOOD_WORD(moodDraft)}`} help="Влево — грустнее, вправо — веселее. Это эмоция музыки, а не её скорость.">
            <Slider aria-label="Настроение" min={-5} max={5} step={1} value={[moodDraft]} onValueChange={([v]) => setMoodDraft(v ?? 0)} onValueCommit={([v]) => set("mood", v ?? 0)} className="py-2" />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Грустная</span><span>Нейтральная</span><span>Весёлая</span></div>
          </Item>
          <Item n={2} title="Скорость музыки" value={`${sign(speedDraft)} · ${SPEED_WORD(speedDraft)}`} help="Меняет темп новой музыки, а не ускоряет готовую запись. Ваш выбор важнее, чем бег или ходьба.">
            <Slider aria-label="Скорость музыки" min={-3} max={3} step={1} value={[speedDraft]} onValueChange={([v]) => setSpeedDraft(v ?? 0)} onValueCommit={([v]) => set("speed", v ?? 0)} className="py-2" />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Медленно</span><span>Средняя</span><span>Быстро</span></div>
          </Item>
          <Item n={3} title="Любимые инструменты" help="Выбери инструменты, которые хочешь слышать чаще. Без выбора инструменты подбираются сами. Редкие инструменты не гарантированы.">
            <NavRow to="/studio/instruments" title="Выбрать инструменты" value={favCount ? `Выбрано: ${favCount}` : "Не выбрано"} />
          </Item>
          <Item n={4} title="Нелюбимые инструменты и жанры" help="Ограничь или исключи нежелательные жанры и инструменты. Исключение сильнее любимых.">
            <NavRow to="/studio/dislikes" title="Настроить ограничения" value={disCount ? `Ограничений: ${disCount}` : "Без ограничений"} />
          </Item>
          <Item n={5} title="Насколько музыка реагирует на мир" help="Насколько заметно дождь и движение меняют музыку. Сильная реакция не делает звук громче.">
            <Segmented label="Реакция" value={s.environmentReaction} onChange={(v) => set("environmentReaction", v)}
              options={[{ value: "weak", label: "Слабо" }, { value: "medium", label: "Средне" }, { value: "strong", label: "Сильно" }]} />
          </Item>
          <Item n={6} title="Смена музыкальной атмосферы" help="Плавный, быстрый или автоматический переход между атмосферами. Один короткий гудок не меняет всю музыку.">
            <Segmented label="Смена атмосферы" value={s.atmosphereTransition} onChange={(v) => set("atmosphereTransition", v)}
              options={[{ value: "smooth", label: "Плавно" }, { value: "fast", label: "Быстро" }, { value: "auto", label: "Автоматически" }]} />
          </Item>
          <Item n={7} title="Насколько разнообразная музыка нужна" help="От привычного звучания до необычных сочетаний. Исключённые жанры не появятся.">
            <Segmented label="Разнообразие" value={s.diversity} onChange={(v) => set("diversity", v)}
              options={[{ value: "familiar", label: "Привычная" }, { value: "moderate", label: "Умеренно разнообразная" }, { value: "experimental", label: "Экспериментальная" }]} />
          </Item>
          <Item n={8} title="Активность" help="Распознавание ходьбы, бега и покоя; можно выбрать вручную. Ручной выбор действует всегда, пока не вернёте «Автоматически». Отсутствие шагов ещё не значит покой.">
            <Segmented label="Активность" value={s.activityMode} onChange={(v) => set("activityMode", v)}
              options={[{ value: "auto", label: "Автоматически" }, { value: "walking", label: "Ходьба" }, { value: "running", label: "Бег" }, { value: "rest", label: "Покой" }, { value: "transport", label: "Транспорт" }]} />
          </Item>
          <Item n={9} title="Продолжительность фрагментов" value="120 секунд" help="Раз в две минуты новая вариация без остановки музыки. Значение фиксировано.">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3.5" /> Не изменяется</p>
          </Item>
          <Item n={10} title="Использование окружающих звуков" help="Звуки управляют музыкой или становятся обработанной частью композиции. Разговоры людей не записываются и не сохраняются.">
            <Segmented label="Окружающие звуки" value={s.useOfEnvironmentSounds} onChange={(v) => set("useOfEnvironmentSounds", v)}
              options={[{ value: "controlOnly", label: "Только управление музыкой" }, { value: "mixProcessed", label: "Добавление обработанных звуков в композицию" }]} />
          </Item>
          <Item n={11} title="Влияние шагов на ритм" help="Насколько заметно шаги влияют на биты и акценты — музыкально, а не стуком на каждый шаг.">
            <Segmented label="Влияние шагов" value={s.stepsInfluence} onChange={(v) => set("stepsInfluence", v)}
              options={[{ value: "weak", label: "Слабое" }, { value: "normal", label: "Обычное" }, { value: "active", label: "Активное" }]} />
          </Item>
        </Section>

        <Section title="Разрешённые музыкальные предпочтения">
          <div className="space-y-1 p-3 text-xs">
            <p>Доступно поджанров: <b>{resolved.allowedSubgenres.length}</b></p>
            <p>Исключено из выбранных: <b>{resolved.blockedSelectedSubgenres}</b></p>
            <p>Любимых инструментов без исключений: <b>{resolved.allowedFavoriteInstruments.length}</b></p>
            {resolved.blockedFavoriteInstruments>0 && <p role="status">
              Исключения имеют приоритет над {resolved.blockedFavoriteInstruments} любимыми инструментами.
            </p>}
            {!resolved.hasPlayablePreferences && <p role="alert" className="text-destructive">
              Нет доступных поджанров. Проверьте музыкальные вкусы и исключения.
            </p>}
            <p className="text-muted-foreground">
              Это результат ваших сохранённых настроек, не уже созданная музыка.
            </p>
          </div>
        </Section>
        <Section title="Дополнительно">
          <NavRow to="/studio/director" title="Музыкальный режиссёр" value={`${s.directorRules.filter((r) => r.enabled).length} правил`} icon={<Wand2 className="size-5" />} />
        </Section>
      </div>
    </>
  );
}
