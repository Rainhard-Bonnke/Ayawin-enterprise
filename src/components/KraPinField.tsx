import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { normalizeKraPin, validateKraPin } from "@/lib/validators";
import { cn } from "@/lib/utils";

type KraPinFieldProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  showSample?: boolean;
};

export function KraPinField({
  id = "kra-pin",
  label = "KRA PIN",
  value,
  onChange,
  className,
  showSample = import.meta.env.DEV,
}: KraPinFieldProps) {
  const normalized = normalizeKraPin(value);
  const check = normalized ? validateKraPin(normalized) : null;
  const valid = check?.ok === true;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {showSample && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onChange("P051999999Z")}
          >
            Use sample
          </Button>
        )}
      </div>
      <Input
        id={id}
        value={value}
        maxLength={11}
        placeholder="P051999999Z"
        className={cn(
          "font-mono uppercase tracking-wide",
          normalized.length === 11 && !valid && "border-destructive",
          valid && "border-success/50",
        )}
        onChange={(e) => {
          const next = e.target.value.replace(/\s/g, "").toUpperCase().slice(0, 11);
          onChange(next);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="text-xs text-muted-foreground">
        Kenya format: <span className="font-mono text-foreground">A</span> + 9 digits +{" "}
        <span className="font-mono text-foreground">Z</span> (11 characters total). Example:{" "}
        <span className="font-mono">P051999999Z</span>
      </p>
      {normalized.length > 0 && !valid && check && (
        <p className="text-xs text-destructive">{check.error}</p>
      )}
    </div>
  );
}
