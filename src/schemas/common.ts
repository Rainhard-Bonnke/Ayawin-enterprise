import { z } from "zod";

export const kraPinSchema = z
  .string()
  .trim()
  .regex(/^[AP][0-9]{9}[A-Z]$/, "Enter a valid KRA PIN");

export const kenyanPhoneSchema = z
  .string()
  .trim()
  .regex(
    /^(?:\+254|0)[17][0-9]{8}$/,
    "Enter a Kenyan mobile number, for example 0712345678 or +254712345678",
  );

export const moneyStringSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{2})$/, "Enter an amount with exactly two decimal places");

// Inventory and transaction quantity columns use NUMERIC(18,4).
export const quantitySchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/,
    "Enter a non-negative quantity with no more than four decimal places",
  );

export const overrideSchema = z.object({
  amount: moneyStringSchema,
  reason: z.string().trim().min(3, "Enter a reason for this override").max(1000),
});
