import { expect, test } from "@playwright/test";

function accessToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: "uat-crm-user",
    email: "crm.user@example.test",
    role_name: "System Administrator",
    permissions: ["sales.view", "sales.create", "sales.order.create", "sales.target.manage"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `test.${payload}.signature`;
}

test("CRM converts lead to opportunity and accepted quote to a sales order", async ({ page }) => {
  const token = accessToken();
  const requests: string[] = [];
  let lead: Record<string, unknown> | null = null;
  let quote: Record<string, unknown> | null = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    requests.push(`${method} ${path}`);
    if (path === "/auth/csrf") return route.fulfill({ json: { csrf_token: "uat-csrf-token" } });
    if (path === "/auth/refresh" && method === "POST") return route.fulfill({ status: 401, json: { error: "No refresh session" } });
    if (path === "/auth/login" && method === "POST") return route.fulfill({ json: { access_token: token, csrf_token: "uat-csrf-token", user: { id: "uat-crm-user", email: "crm.user@example.test", username: "crm.user", role_name: "System Administrator", permissions: ["sales.view", "sales.create", "sales.order.create", "sales.target.manage"] } } });
    if (path === "/auth/me") return route.fulfill({ json: { id: "uat-crm-user", email: "crm.user@example.test", username: "crm.user", role_name: "System Administrator", permissions: ["sales.view", "sales.create", "sales.order.create", "sales.target.manage"] } });
    if (path === "/master/customers") return route.fulfill({ json: { data: [{ id: "customer-1", name: "UAT Retailer", email: "buyer@example.test" }] } });
    if (path === "/master/items") return route.fulfill({ json: { data: [{ id: "item-1", item_code: "UAT-001", name: "UAT Product", is_active: true }] } });
    if (path === "/master/warehouses") return route.fulfill({ json: { data: [{ id: "warehouse-1", code: "UAT-WH", name: "UAT Warehouse", is_active: true }] } });
    if (path === "/crm/leads" && method === "GET") return route.fulfill({ json: { data: lead ? [lead] : [], pagination: { total: lead ? 1 : 0 } } });
    if (path === "/crm/leads" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      lead = { ...body, id: "lead-1", lead_no: "LEAD-2026-0001", status: "new" };
      return route.fulfill({ status: 201, json: lead });
    }
    if (path === "/crm/leads/lead-1/convert" && method === "POST") return route.fulfill({ status: 201, json: { lead: { id: "lead-1", status: "converted" }, customer: { id: "customer-2", name: "UAT Prospect" }, opportunity: { id: "opportunity-1", name: "UAT Prospect" } } });
    if (path === "/crm/opportunities" && method === "GET") return route.fulfill({ json: [] });
    if (path === "/crm/quotes" && method === "GET") return route.fulfill({ json: { data: quote ? [quote] : [] } });
    if (path === "/crm/activities" && method === "GET") return route.fulfill({ json: [] });
    if (path === "/crm/quotes" && method === "POST") {
      quote = { id: "quote-1", quote_no: "QT-2026-0001", customer_id: "customer-1", customer_name: "UAT Retailer", quote_date: new Date().toISOString().slice(0, 10), valid_until: null, status: "draft", total_amount: 140 };
      return route.fulfill({ status: 201, json: quote });
    }
    if (path === "/crm/quotes/quote-1/accept" && method === "POST") {
      quote = { ...quote, status: "accepted" };
      return route.fulfill({ json: quote });
    }
    if (path === "/crm/quotes/quote-1/convert-order" && method === "POST") return route.fulfill({ status: 201, json: { quote: { ...quote, status: "converted" }, salesOrder: { id: "order-1", order_no: "SO-2026-0001" } } });
    return route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${path}` } });
  });

  await page.goto("/login");
  await page.getByLabel("Email or username").fill("crm.user@example.test");
  await page.getByLabel("Password").fill("uat-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.getByRole("link", { name: "CRM & quotations" }).click();
  await expect(page.getByRole("heading", { name: "CRM & quotations" })).toBeVisible();

  await page.getByLabel("Organization").fill("UAT Prospect");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("LEAD-2026-0001")).toBeVisible();
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByText("Lead converted to customer and opportunity")).toBeVisible();

  await page.getByRole("tab", { name: "Quotations" }).click();
  await page.getByLabel("Customer").selectOption("customer-1");
  await page.getByLabel("Item").selectOption("item-1");
  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page.getByText("QT-2026-0001")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Convert" }).click();
  await page.getByLabel("Warehouse").selectOption("warehouse-1");
  await page.getByLabel("Required delivery date").fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create sales order" }).click();
  await expect(page.getByText("Quotation converted to sales order")).toBeVisible();
  expect(requests).toContain("POST /crm/leads/lead-1/convert");
  expect(requests).toContain("POST /crm/quotes/quote-1/accept");
  expect(requests).toContain("POST /crm/quotes/quote-1/convert-order");
});
