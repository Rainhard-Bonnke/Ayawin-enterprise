import { expect, test } from "@playwright/test";

function accessToken(role: string, permissions: string[]) {
  const payload = Buffer.from(JSON.stringify({
    sub: "uat-pos-operator",
    email: "pos.operator@example.test",
    role_name: role,
    permissions,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `test.${payload}.signature`;
}

test("POS Operator completes a stock-aware cash sale", async ({ page }) => {
  const token = accessToken("POS Operator", [
    "sales.order.create",
    "sales.delivery.post",
    "sales.invoice.create",
    "sales.receipt.create",
  ]);
  const calls: string[] = [];
  let delivered = false;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    calls.push(`${method} ${path}`);

    if (path === "/auth/csrf") {
      await route.fulfill({ json: { csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/refresh" && method === "POST") {
      await route.fulfill({ json: { access_token: token, csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/me") {
      await route.fulfill({
        json: {
          id: "uat-pos-operator",
          email: "pos.operator@example.test",
          username: "pos.operator",
          role_name: "POS Operator",
          permissions: [
            "sales.order.create",
            "sales.delivery.post",
            "sales.invoice.create",
            "sales.receipt.create",
          ],
        },
      });
    } else if (path === "/master/items") {
      await route.fulfill({ json: { data: [{ id: "item-1", item_code: "UAT-001", name: "UAT Product", standard_cost: 100, is_active: true }] } });
    } else if (path === "/master/customers") {
      await route.fulfill({ json: { data: [{ id: "customer-1", name: "UAT Retailer", customer_type: "Retailer", tax_id: "P000000001A" }] } });
    } else if (path === "/master/warehouses") {
      await route.fulfill({ json: { data: [{ id: "warehouse-1", code: "UAT-WH", name: "UAT Warehouse", is_active: true }] } });
    } else if (path === "/sales/tax-preview" && method === "POST") {
      const body = request.postDataJSON() as { lines: Array<{ quantity: number; unit_price: number }> };
      const subtotal = body.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
      await route.fulfill({ json: { subtotal, tax_amount: 0, total_amount: subtotal, lines: [] } });
    } else if (path === "/sales/orders" && method === "POST") {
      await route.fulfill({ status: 201, json: { id: "order-id-1", order_no: "SO-POS-001", total_amount: 140, status: "draft" } });
    } else if (path === "/sales/orders/order-id-1/confirm" && method === "POST") {
      await route.fulfill({ json: { ok: true } });
    } else if (path === "/sales/orders/order-id-1" && method === "GET") {
      await route.fulfill({
        json: {
          id: "order-id-1",
          order_no: "SO-POS-001",
          customer_id: "customer-1",
          warehouse_id: "warehouse-1",
          lines: [{ id: "line-1", item_id: "item-1", quantity: 1, qty_delivered: delivered ? 1 : 0, qty_invoiced: 0, unit_price: 140 }],
        },
      });
    } else if (path === "/sales/deliveries" && method === "POST") {
      delivered = true;
      await route.fulfill({ status: 201, json: { ok: true, delivery_id: "delivery-1" } });
    } else if (path === "/sales/invoices" && method === "POST") {
      await route.fulfill({ status: 201, json: { ok: true, invoice_id: "invoice-1", invoice_no: "INV-POS-001" } });
    } else if (path === "/sales/invoices/invoice-1/pay" && method === "POST") {
      await route.fulfill({ status: 201, json: { ok: true, payment_no: "RCT-POS-001", status: "posted", amount_paid: 140 } });
    } else if (path === "/sales/invoices/INV-POS-001/receipt-pdf") {
      await route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4 UAT receipt" });
    } else {
      await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${path}` } });
    }
  });

  const authenticatedUser = page.waitForResponse((response) => response.url().includes("/api/v1/auth/me"));
  await page.goto("/login");
  await authenticatedUser;
  await page.goto("/pos");

  await expect(page.getByRole("heading", { name: "Fast checkout" })).toBeVisible();
  const taxPreview = page.waitForResponse((response) => response.url().endsWith("/api/v1/sales/tax-preview"));
  await page.getByRole("button", { name: /UAT Product/ }).click();
  await taxPreview;
  await expect(page.getByRole("button", { name: /Complete sale · KES 140/ })).toBeVisible();
  await page.getByLabel("Amount received").fill("140");

  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.getByText("Sale completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Receipt INV-POS-001")).toBeVisible();
  expect(calls).toContain("POST /sales/orders/order-id-1/confirm");
  expect(calls).toContain("POST /sales/deliveries");
  expect(calls).toContain("POST /sales/invoices");
  expect(calls).toContain("POST /sales/invoices/invoice-1/pay");
  expect(calls.filter((call) => call === "GET /sales/invoices/INV-POS-001/receipt-pdf")).toHaveLength(2);
});
