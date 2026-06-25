import { Moon, Sun } from "lucide-react";
import type { Theme } from "../hooks/useTheme";

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button className="icon-button" onClick={onToggle} title="Toggle theme" type="button">
      <Icon size={16} strokeWidth={1.8} />
    </button>
  );
}
