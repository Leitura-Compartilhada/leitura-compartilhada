import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  nextThemeChoice,
  setThemeChoice,
  THEME_LABELS,
  type ThemeChoice,
  useThemeChoice,
} from "@/lib/theme";

const ICONS: Record<ThemeChoice, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/** Alterna o tema do app: automático (sistema), claro e escuro. */
export function ThemeToggle() {
  const choice = useThemeChoice();
  const Icon = ICONS[choice];
  const next = nextThemeChoice(choice);
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="theme-toggle"
      data-theme-choice={choice}
      aria-label={`Tema: ${THEME_LABELS[choice]}. Mudar para ${THEME_LABELS[next]}`}
      title={`Tema: ${THEME_LABELS[choice]}`}
      onClick={() => setThemeChoice(next)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}
