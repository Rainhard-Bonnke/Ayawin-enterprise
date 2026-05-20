export const KES = (n: number) =>
  "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const KES2 = (n: number) =>
  "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (d: Date | string) => {
  const date = typeof d === "string" ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
};

// Kenya excise rates (KES per litre)
export const EXCISE_RATES: Record<string, number> = {
  Beer: 121.85,
  Spirits: 356.28,
  Wine: 229.85,
  "Soft Drinks": 10.68,
  Water: 0,
  Juice: 10.68,
};

export const VAT_RATE = 0.16;

export function calcExcise(category: string, litres: number) {
  return (EXCISE_RATES[category] ?? 0) * litres;
}
