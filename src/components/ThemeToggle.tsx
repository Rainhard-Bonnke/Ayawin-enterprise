import { MoonStar, SunMedium } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeMode } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useThemeMode();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9 rounded-lg"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
    </Button>
  );
}
