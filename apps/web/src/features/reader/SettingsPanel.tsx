import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  type AppTheme,
  clampFontPercent,
  clampLineHeight,
  FLOW_LABELS,
  FLOWS,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  FONT_STEP_PERCENT,
  LINE_HEIGHT_STEP,
  MARGIN_CHOICES,
  MAX_AUTO_SCROLL_SPEED,
  MAX_FONT_PERCENT,
  MAX_LINE_HEIGHT,
  MIN_AUTO_SCROLL_SPEED,
  MIN_FONT_PERCENT,
  MIN_LINE_HEIGHT,
  PALETTES,
  type ReaderColumns,
  type ReaderFlow,
  type ReaderFontFamily,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderThemeChoice,
  type ReaderWidth,
  THEME_LABELS,
  THEMES,
  WIDTH_CHOICES,
} from "./prefs";

type Option<T> = { value: T; label: string };

const WIDTH_LABELS: Record<ReaderWidth, string> = {
  480: "Estreita",
  600: "Média",
  720: "Padrão",
  840: "Larga",
  960: "Ampla",
};

const COLUMN_OPTIONS: Option<ReaderColumns>[] = [
  { value: "auto", label: "Automático" },
  { value: 1, label: "1 coluna" },
  { value: 2, label: "2 colunas" },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-current/10 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide opacity-70">{title}</h3>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-w-0 flex-1 rounded-md border-2 px-2 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-current/50 disabled:opacity-40 ${value === option.value ? "border-current font-semibold" : "border-current/20"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-sm font-medium">
        {label}
        <output className="tabular-nums opacity-80">{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full cursor-pointer accent-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      />
    </label>
  );
}

type Props = {
  prefs: ReaderPrefs;
  appTheme: AppTheme;
  onChange: (next: ReaderPrefs) => void;
};

/** Painel "Aparência": tema, texto, layout e rolagem automática. */
export function SettingsPanel({ prefs, appTheme, onChange }: Props) {
  const set = (patch: Partial<ReaderPrefs>) => onChange({ ...prefs, ...patch });
  const scrolled = prefs.flow === "scrolled";

  const themeOptions: { value: ReaderThemeChoice; label: string; palette: ReaderTheme }[] = [
    { value: "app", label: "Do app", palette: appTheme },
    ...THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme], palette: theme })),
  ];

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <Group title="Tema">
        <fieldset className="space-y-2">
          <legend className="sr-only">Tema do leitor</legend>
          <div className="grid grid-cols-2 gap-2">
            {themeOptions.map((option) => {
              const palette = PALETTES[option.palette];
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={prefs.theme === option.value}
                  onClick={() => set({ theme: option.value })}
                  className="rounded-md border-2 px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-current/50"
                  style={{
                    background: palette.background,
                    color: palette.foreground,
                    borderColor: prefs.theme === option.value ? "currentColor" : "transparent",
                    boxShadow: "inset 0 0 0 1px rgb(128 128 128 / 0.4)",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Group>

      <Group title="Texto">
        <div className="space-y-2">
          <p className="text-sm font-medium">Tamanho da fonte</p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              aria-label="Diminuir a fonte"
              disabled={prefs.fontPercent <= MIN_FONT_PERCENT}
              onClick={() =>
                set({ fontPercent: clampFontPercent(prefs.fontPercent - FONT_STEP_PERCENT) })
              }
              style={{ background: "transparent", color: "inherit" }}
            >
              <Minus className="size-4" aria-hidden="true" />
            </Button>
            <output className="w-14 text-center text-sm tabular-nums" aria-live="polite">
              {prefs.fontPercent}%
            </output>
            <Button
              variant="outline"
              size="sm"
              aria-label="Aumentar a fonte"
              disabled={prefs.fontPercent >= MAX_FONT_PERCENT}
              onClick={() =>
                set({ fontPercent: clampFontPercent(prefs.fontPercent + FONT_STEP_PERCENT) })
              }
              style={{ background: "transparent", color: "inherit" }}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <Segmented<ReaderFontFamily>
          label="Fonte"
          value={prefs.fontFamily}
          options={FONT_FAMILIES.map((family) => ({
            value: family,
            label: FONT_FAMILY_LABELS[family],
          }))}
          onChange={(fontFamily) => set({ fontFamily })}
        />

        <Slider
          label="Entrelinha"
          min={MIN_LINE_HEIGHT}
          max={MAX_LINE_HEIGHT}
          step={LINE_HEIGHT_STEP}
          value={prefs.lineHeight}
          display={prefs.lineHeight.toFixed(2)}
          onChange={(value) => set({ lineHeight: clampLineHeight(value) })}
        />

        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Justificar o texto
          <input
            type="checkbox"
            checked={prefs.justify}
            onChange={(event) => set({ justify: event.target.checked })}
            className="size-5 accent-current"
          />
        </label>
      </Group>

      <Group title="Layout">
        <Segmented<ReaderFlow>
          label="Modo de leitura"
          value={prefs.flow}
          options={FLOWS.map((flow) => ({ value: flow, label: FLOW_LABELS[flow] }))}
          onChange={(flow) => set({ flow })}
        />
        <Segmented<ReaderColumns>
          label="Colunas"
          value={prefs.columns}
          options={COLUMN_OPTIONS}
          disabled={scrolled}
          onChange={(columns) => set({ columns })}
        />
        {scrolled ? (
          <p className="text-xs opacity-70">Colunas só valem no modo em páginas.</p>
        ) : null}
        <Segmented<ReaderWidth>
          label="Largura do texto"
          value={prefs.maxWidth}
          options={WIDTH_CHOICES.map((width) => ({ value: width, label: WIDTH_LABELS[width] }))}
          onChange={(maxWidth) => set({ maxWidth })}
        />
        <Segmented<number>
          label="Margens"
          value={prefs.margin}
          options={MARGIN_CHOICES}
          onChange={(margin) => set({ margin })}
        />
      </Group>

      <Group title="Rolagem automática">
        <Slider
          label="Velocidade"
          min={MIN_AUTO_SCROLL_SPEED}
          max={MAX_AUTO_SCROLL_SPEED}
          step={1}
          value={prefs.autoScrollSpeed}
          display={`${prefs.autoScrollSpeed} de ${MAX_AUTO_SCROLL_SPEED}`}
          onChange={(autoScrollSpeed) => set({ autoScrollSpeed })}
        />
        <p className="text-xs opacity-70">
          {scrolled
            ? "Rola o texto sozinho. Tocar na tela, rolar ou apertar uma tecla pausa."
            : "No modo em páginas, vira a página de tempos em tempos."}{" "}
          Inicie pelo botão de reprodução no topo.
        </p>
      </Group>
    </div>
  );
}
