import { MoonStar, SunMedium } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeMode } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useThemeMode();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      className="gap-2 border-border/70 bg-background/80"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
      <span className="hidden sm:inline">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </Button>
  );
}
