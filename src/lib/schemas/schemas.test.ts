import { describe, expect, it } from "vitest";
import { loginSchema } from "./auth";
import { bankReconciliationSchema } from "./finance";
import { invoiceSchema, posCheckoutSchema, salesOrderSchema } from "./sales";

describe("loginSchema", () => {
  it("accepts and trims a non-empty username", () => {
    expect(loginSchema.parse({ username: "  user@example.test  ", password: "secret" })).toEqual({
      username: "user@example.test",
      password: "secret",
    });
  });

  it("rejects missing credentials", () => {
    expect(loginSchema.safeParse({ username: "", password: "" }).success).toBe(false);
  });
});

describe("bankReconciliationSchema", () => {
  const validStatement = {
    bankAccountId: "bank-1",
    reference: "Statement 2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    openingBalance: "1000.00",
    closingBalance: "950.00",
    lines: [
      {
        transaction_date: "2026-10-03",
        reference: "TX-1",
        description: "Supplier payment",
        debit: 50,
        credit: 0,
      },
    ],
  };

  it("accepts a dated statement with non-negative one-sided lines", () => {
    expect(bankReconciliationSchema.safeParse(validStatement).success).toBe(true);
  });

  it("rejects reversed dates and lines with both debit and credit", () => {
    const result = bankReconciliationSchema.safeParse({
      ...validStatement,
      startDate: "2026-11-01",
      endDate: "2026-10-01",
      lines: [{ ...validStatement.lines[0], debit: 10, credit: 10 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("invoiceSchema", () => {
  const validInvoice = {
    customer_id: "customer-1",
    invoice_date: "2026-10-01",
    due_date: "2026-10-31",
    lines: [{ item_id: "item-1", quantity: 2, unit_price: 10 }],
  };

  it("accepts a valid invoice", () => {
    expect(invoiceSchema.safeParse(validInvoice).success).toBe(true);
  });

  it("rejects a due date before invoice date and non-positive quantities", () => {
    const result = invoiceSchema.safeParse({
      ...validInvoice,
      due_date: "2026-09-30",
      lines: [{ ...validInvoice.lines[0], quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("salesOrderSchema", () => {
  it("accepts a valid sales order draft", () => {
    expect(
      salesOrderSchema.safeParse({
        customer_id: "customer-1",
        warehouse_id: "warehouse-1",
        order_date: "2026-10-01",
        required_date: "2026-10-05",
        notes: "Customer call confirmed",
        lines: [{ item_id: "item-1", quantity: 2, unit_price: 150 }],
      }).success,
    ).toBe(true);
  });

  it("rejects missing warehouse or a required date before the order date", () => {
    const result = salesOrderSchema.safeParse({
      customer_id: "customer-1",
      warehouse_id: "",
      order_date: "2026-10-05",
      required_date: "2026-10-03",
      lines: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("posCheckoutSchema", () => {
  it.each(["cash", "card", "mobile_money", "credit"])(
    "accepts the POS payment method %s",
    (payment_method) => {
      expect(
        posCheckoutSchema.safeParse({
          customer_id: "customer-1",
          warehouse_id: "warehouse-1",
          order_date: "2026-10-01",
          required_date: "2026-10-01",
          payment_method,
          amount_received: 25,
          lines: [{ item_id: "item-1", quantity: 1, unit_price: 25 }],
        }).success,
      ).toBe(true);
    },
  );
});
