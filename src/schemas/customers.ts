import { z } from "zod";
import { kenyanPhoneSchema, kraPinSchema, moneyStringSchema } from "./common";

const optionalPhoneSchema = z.union([z.literal(""), kenyanPhoneSchema]);
const optionalEmailSchema = z.union([
  z.literal(""),
  z.string().trim().email("Enter a valid email address"),
]);

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(200),
  kra_pin: kraPinSchema,
  contact: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: z.string().trim().max(500),
  location: z.string().trim().max(200),
  type: z.string().trim().min(1, "Customer type is required").max(100),
  segment: z.string().trim().min(1, "Customer segment is required").max(100),
  credit_limit: moneyStringSchema,
  payment_terms: z.string().trim().min(1, "Payment terms are required").max(100),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;
