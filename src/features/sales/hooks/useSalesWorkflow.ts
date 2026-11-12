import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v1Api } from "@/lib/api-v1";
import type {
  BackendSalesOrder,
  SalesAnalytics,
  SalesOrderDetail,
} from "@/lib/api-types";
import { queryKeys } from "@/lib/queryKeys";

type SalesOrderInput = {
  customer_id: string;
  warehouse_id: string;
  order_date?: string;
  required_date: string;
  notes?: string;
  lines: Array<{ item_id: string; quantity: number; unit_price: number }>;
};

function normalizeOrder(row: Record<string, unknown>, lineCount: number): BackendSalesOrder & { internal_id: string } {
  const rawStatus = String(row.status || "draft").toLowerCase();
  const status: BackendSalesOrder["status"] =
    rawStatus === "confirmed"
      ? "Confirmed"
      : rawStatus === "delivered"
        ? "Delivered"
        : rawStatus === "partial"
          ? "Partial"
          : rawStatus === "cancelled"
            ? "Cancelled"
            : "Draft";
  return {
    id: String(row.order_no || row.id || ""),
    internal_id: String(row.id || ""),
    date: String(row.order_date || "").slice(0, 10),
    customer: String(row.customer_name || ""),
    rep: String(row.sales_rep_name || "—"),
    items: lineCount,
    total: Number(row.total_amount || 0),
    status,
  };
}

async function dispatchOrder(token: string, internalId: string) {
  const order = await v1Api.sales.orderDetail(token, internalId);
  const warehouseId = String(order.warehouse_id || "");
  if (!warehouseId) throw new Error("This order has no warehouse. Set its warehouse before dispatch.");
  const lines = (order.lines || [])
    .map((line) => ({
      so_line_id: String(line.id || ""),
      item_id: String(line.item_id || ""),
      quantity: Number(line.quantity || 0) - Number(line.qty_delivered || 0),
    }))
    .filter((line) => line.so_line_id && line.item_id && line.quantity > 0);
  if (!lines.length) throw new Error("No open quantities left to dispatch for this order.");
  return v1Api.sales.createDelivery(token, {
    sales_order_id: internalId,
    warehouse_id: warehouseId,
    delivery_date: new Date().toISOString().slice(0, 10),
    lines,
  });
}

async function invoiceDeliveredOrder(token: string, internalId: string) {
  const order = await v1Api.sales.orderDetail(token, internalId);
  const customerId = String(order.customer_id || "");
  if (!customerId) throw new Error("Order is missing customer information.");
  const lines = (order.lines || [])
    .map((line) => ({
      so_line_id: String(line.id || ""),
      item_id: String(line.item_id || ""),
      quantity: Number(line.qty_delivered || 0) - Number(line.qty_invoiced || 0),
      unit_price: Number(line.unit_price || 0),
    }))
    .filter((line) => line.so_line_id && line.item_id && line.quantity > 0);
  if (!lines.length) throw new Error("No delivered quantities left to invoice for this order.");
  return v1Api.sales.createInvoice(token, {
    customer_id: customerId,
    sales_order_id: internalId,
    invoice_date: new Date().toISOString().slice(0, 10),
    lines,
  });
}

function saveReceipt(invoiceNo: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `receipt-${invoiceNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useSalesWorkflow() {
  const queryClient = useQueryClient();
  const invalidateSales = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.orders() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.list() });
  };
  const createOrderMutation = useMutation({
    mutationFn: ({ token, payload }: { token: string; payload: SalesOrderInput }) =>
      v1Api.sales.createOrder(token, payload).then((row) => normalizeOrder(row, payload.lines.length)),
    onSuccess: invalidateSales,
  });
  const confirmOrderMutation = useMutation({
    mutationFn: ({ token, id }: { token: string; id: string }) => v1Api.sales.confirmOrder(token, id),
    onSuccess: invalidateSales,
  });
  const cancelOrderMutation = useMutation({
    mutationFn: ({ token, id }: { token: string; id: string }) => v1Api.sales.cancelOrder(token, id),
    onSuccess: invalidateSales,
  });
  const dispatchOrderMutation = useMutation({
    mutationFn: ({ token, id }: { token: string; id: string }) => dispatchOrder(token, id),
    onSuccess: invalidateSales,
  });
  const invoiceOrderMutation = useMutation({
    mutationFn: ({ token, id }: { token: string; id: string }) => invoiceDeliveredOrder(token, id),
    onSuccess: invalidateSales,
  });
  const payInvoiceMutation = useMutation({
    mutationFn: ({ token, id, payload }: {
      token: string;
      id: string;
      payload: { amount: number; payment_date?: string; reference_no?: string; notes?: string };
    }) => v1Api.sales.payInvoice(token, id, payload),
    onSuccess: invalidateSales,
  });

  return {
    createSalesOrder: (token: string, payload: SalesOrderInput) =>
      createOrderMutation.mutateAsync({ token, payload }),
    confirmSalesOrder: (token: string, id: string) => confirmOrderMutation.mutateAsync({ token, id }),
    cancelSalesOrder: (token: string, id: string) => cancelOrderMutation.mutateAsync({ token, id }),
    dispatchSalesOrder: (token: string, id: string) => dispatchOrderMutation.mutateAsync({ token, id }),
    createInvoiceFromSalesOrder: (token: string, id: string) => invoiceOrderMutation.mutateAsync({ token, id }),
    paySalesInvoice: (token: string, id: string, payload: { amount: number; payment_date?: string; reference_no?: string; notes?: string }) =>
      payInvoiceMutation.mutateAsync({ token, id, payload }),
    fetchSalesAnalytics: async (token: string) => v1Api.sales.analytics(token) as Promise<SalesAnalytics>,
    fetchSalesOrderDetail: async (token: string, id: string) =>
      v1Api.sales.orderDetail(token, id) as Promise<SalesOrderDetail>,
    downloadReceiptPdf: async (token: string, invoiceNo: string) =>
      saveReceipt(invoiceNo, await v1Api.sales.downloadReceiptPdf(token, invoiceNo)),
    printReceiptPdf: async (token: string, invoiceNo: string) => {
      const url = URL.createObjectURL(await v1Api.sales.downloadReceiptPdf(token, invoiceNo));
      const printWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (!printWindow) {
        URL.revokeObjectURL(url);
        throw new Error("Allow pop-ups to print the receipt.");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}
