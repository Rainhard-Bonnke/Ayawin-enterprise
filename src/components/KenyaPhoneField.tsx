import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeKenyaPhone, validateKenyaPhone } from "@/lib/validators";
import { cn } from "@/lib/utils";

type KenyaPhoneFieldProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
};

export function KenyaPhoneField({
  id = "kenya-phone",
  label = "Phone",
  value,
  onChange,
  className,
  required = false,
}: KenyaPhoneFieldProps) {
  const trimmed = value.trim();
  const check = trimmed ? validateKenyaPhone(trimmed) : required ? validateKenyaPhone("", { required: true }) : null;
  const valid = check?.ok === true;
  const showError = trimmed.length > 0 && check && !check.ok;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="tel"
        value={value}
        placeholder="0712 345 678"
        autoComplete="tel"
        className={cn(showError && "border-destructive", valid && trimmed && "border-success/50")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!trimmed) return;
          const normalized = normalizeKenyaPhone(trimmed);
          if (normalized !== trimmed && /^\+254[17]\d{8}$/.test(normalized)) {
            onChange(normalized);
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        Kenya mobile: <span className="font-mono">07XXXXXXXX</span> or{" "}
        <span className="font-mono">+254 7XXXXXXXX</span> — country code is added once on save.
      </p>
      {showError && check && <p className="text-xs text-destructive">{check.error}</p>}
    </div>
  );
}
