import { Moon, Sun } from "lucide-react";
import type { Theme } from "../hooks/useTheme";

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const Icon = theme === "dark" ? Sun : Moon;
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button aria-label={label} className="icon-button" onClick={onToggle} title={label} type="button">
      <Icon size={16} strokeWidth={1.8} />
    </button>
  );
}
