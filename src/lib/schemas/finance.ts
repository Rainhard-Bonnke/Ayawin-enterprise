import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const decimalAmount = z.string().trim().min(1, "Enter a balance.").refine(
  (value) => Number.isFinite(Number(value)),
  "Enter a valid balance.",
);

export const bankReconciliationSchema = z.object({
  bankAccountId: z.string().min(1, "Choose a bank or cash account."),
  reference: z.string().trim().min(1, "Enter the statement reference.").max(100),
  startDate: isoDate,
  endDate: isoDate,
  openingBalance: decimalAmount,
  closingBalance: decimalAmount,
  lines: z.array(z.object({
    transaction_date: isoDate,
    description: z.string().trim().min(1, "Each statement line needs a description."),
    debit: z.number().finite().min(0),
    credit: z.number().finite().min(0),
  })).min(1, "Import at least one statement transaction."),
}).superRefine((value, context) => {
  if (value.startDate > value.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date must be on or after the start date.",
    });
  }
  if (value.lines.some((line) => line.debit > 0 && line.credit > 0)) {
    context.addIssue({
      code: "custom",
      path: ["lines"],
      message: "A statement line cannot have both a debit and a credit.",
    });
  }
});

export type BankReconciliationFormValues = z.infer<typeof bankReconciliationSchema>;