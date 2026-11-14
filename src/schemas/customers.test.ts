import { describe, expect, it } from "vitest";
import { customerFormSchema } from "./customers";

const validCustomer = {
  name: "Nairobi Drinks",
  kra_pin: "A123456789Z",
  contact: "+254712345678",
  email: "orders@example.test",
  address: "Industrial Area",
  location: "Nairobi",
  type: "Distributor",
  segment: "Distributor",
  credit_limit: "25000.00",
  payment_terms: "Net 30",
};

describe("customer form schema", () => {
  it("accepts valid customer identity, contact, and monetary fields", () => {
    expect(customerFormSchema.safeParse(validCustomer).success).toBe(true);
  });

  it("rejects malformed KRA PIN, phone, and non-exact money strings", () => {
    expect(customerFormSchema.safeParse({ ...validCustomer, kra_pin: "B123456789Z" }).success).toBe(
      false,
    );
    expect(customerFormSchema.safeParse({ ...validCustomer, contact: "071234567" }).success).toBe(
      false,
    );
    expect(customerFormSchema.safeParse({ ...validCustomer, credit_limit: "25000" }).success).toBe(
      false,
    );
  });

  it("allows optional phone and email values to be blank", () => {
    expect(customerFormSchema.safeParse({ ...validCustomer, contact: "", email: "" }).success).toBe(
      true,
    );
  });
});
