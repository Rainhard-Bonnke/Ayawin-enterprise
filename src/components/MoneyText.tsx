import { cn } from "@/lib/utils";

type MoneyTextProps = {
  value: number | string | null | undefined;
  currency?: string;
  className?: string;
};

export function MoneyText({ value, currency = "KES", className }: MoneyTextProps) {
  const amount = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(amount)) {
    return <span className={cn("tabular-nums", className)}>—</span>;
  }

  const formatted = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return (
    <span className={cn("tabular-nums", className)}>
      {currency} {formatted}
    </span>
  );
}
