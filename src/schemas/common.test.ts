import { describe, expect, it } from "vitest";
import {
  kraPinSchema,
  kenyanPhoneSchema,
  moneyStringSchema,
  quantitySchema,
  overrideSchema,
} from "./common";

describe("shared form validation", () => {
  it("accepts KRA PINs in the documented shape only", () => {
    expect(kraPinSchema.safeParse("A123456789Z").success).toBe(true);
    expect(kraPinSchema.safeParse("P123456789A").success).toBe(true);
    expect(kraPinSchema.safeParse("A12345678Z").success).toBe(false);
    expect(kraPinSchema.safeParse("B123456789Z").success).toBe(false);
  });

  it("accepts Kenyan mobile number formats supported by the API", () => {
    expect(kenyanPhoneSchema.safeParse("0712345678").success).toBe(true);
    expect(kenyanPhoneSchema.safeParse("+254712345678").success).toBe(true);
    expect(kenyanPhoneSchema.safeParse("254712345678").success).toBe(false);
    expect(kenyanPhoneSchema.safeParse("071234567").success).toBe(false);
  });

  it("accepts money strings with exactly two decimal places", () => {
    expect(moneyStringSchema.safeParse("0.00").success).toBe(true);
    expect(moneyStringSchema.safeParse("10000.25").success).toBe(true);
    expect(moneyStringSchema.safeParse("10000").success).toBe(false);
    expect(moneyStringSchema.safeParse("10.2").success).toBe(false);
  });

  it("allows no more than the database quantity scale", () => {
    expect(quantitySchema.safeParse("12.1234").success).toBe(true);
    expect(quantitySchema.safeParse("12.12345").success).toBe(false);
    expect(quantitySchema.safeParse("-1").success).toBe(false);
  });

  it("requires a reason when a user requests an override", () => {
    expect(overrideSchema.safeParse({ amount: "100.00", reason: "" }).success).toBe(false);
    expect(
      overrideSchema.safeParse({ amount: "100.00", reason: "Approved exception" }).success,
    ).toBe(true);
  });
});
