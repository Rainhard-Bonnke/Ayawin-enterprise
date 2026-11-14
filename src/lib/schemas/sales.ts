import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const salesLineSchema = z.object({
  item_id: z.string().min(1, "Select an item."),
  quantity: z.number().finite().positive("Quantity must be greater than zero."),
  unit_price: z.number().finite().min(0, "Unit price cannot be negative."),
});

export const invoiceSchema = z
  .object({
    customer_id: z.string().min(1, "Select a customer."),
    invoice_date: isoDate,
    due_date: isoDate,
    lines: z.array(salesLineSchema).min(1, "Add at least one invoice line."),
  })
  .superRefine((invoice, context) => {
    if (invoice.due_date < invoice.invoice_date) {
      context.addIssue({
        code: "custom",
        path: ["due_date"],
        message: "The due date cannot be before the invoice date.",
      });
    }
  });

const salesOrderBaseSchema = z.object({
  customer_id: z.string().min(1, "Select a customer."),
  warehouse_id: z.string().min(1, "Select a warehouse."),
  order_date: isoDate,
  required_date: isoDate,
  notes: z.string().max(2000, "Notes are too long.").optional().or(z.literal("")),
  lines: z.array(salesLineSchema).min(1, "Add at least one order line."),
});

export const salesOrderSchema = salesOrderBaseSchema.superRefine((order, context) => {
  if (order.required_date < order.order_date) {
    context.addIssue({
      code: "custom",
      path: ["required_date"],
      message: "The required delivery date cannot be before the order date.",
    });
  }
});

export const posCheckoutSchema = salesOrderBaseSchema.extend({
  payment_method: z.enum(["cash", "card", "mobile_money", "credit"]).default("cash"),
  amount_received: z.number().finite().min(0, "Amount received cannot be negative.").optional(),
});

export type InvoiceFormValues = z.infer<typeof invoiceSchema>;
export type SalesOrderFormValues = z.infer<typeof salesOrderSchema>;
