import { expect, test } from "@playwright/test";

function accessToken(role: string, permissions: string[]) {
  const payload = Buffer.from(JSON.stringify({
    sub: "uat-sales-rep",
    email: "sales.rep@example.test",
    role_name: role,
    permissions,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `test.${payload}.signature`;
}

test("Sales Rep creates a draft order and cannot approve it", async ({ page }) => {
  const token = accessToken("Sales Rep", ["sales.order.create"]);
  let createdOrder: Record<string, unknown> | null = null;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();

    if (path === "/auth/csrf") {
      await route.fulfill({ json: { csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/refresh" && method === "POST") {
      await route.fulfill({ json: { access_token: token, csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/me") {
      await route.fulfill({
        json: {
          id: "uat-sales-rep",
          email: "sales.rep@example.test",
          username: "sales.rep",
          role_name: "Sales Rep",
          permissions: ["sales.order.create"],
        },
      });
    } else if (path === "/master/customers") {
      await route.fulfill({ json: { data: [{ id: "customer-1", name: "UAT Retailer", customer_type: "Retailer", tax_id: "P000000001A" }] } });
    } else if (path === "/master/items") {
      await route.fulfill({ json: { data: [{ id: "item-1", item_code: "UAT-001", name: "UAT Product", standard_cost: 100, is_active: true }] } });
    } else if (path === "/master/warehouses") {
      await route.fulfill({ json: { data: [{ id: "warehouse-1", code: "UAT-WH", name: "UAT Warehouse", is_active: true }] } });
    } else if (path === "/sales/orders" && method === "GET") {
      await route.fulfill({ json: createdOrder ? [createdOrder] : [] });
    } else if (path === "/sales/orders" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      createdOrder = {
        id: "order-id-1",
        order_no: "SO-UAT-001",
        order_date: body.order_date,
        customer_name: "UAT Retailer",
        status: "draft",
        total_amount: 140,
      };
      await route.fulfill({ status: 201, json: createdOrder });
    } else {
      await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${path}` } });
    }
  });

  const authenticatedUser = page.waitForResponse((response) => response.url().includes("/api/v1/auth/me"));
  await page.goto("/login");
  await authenticatedUser;
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales & Orders" })).toBeVisible();
  const newOrderButton = page.getByRole("button", { name: "New Sales Order" });
  await newOrderButton.click();
  await expect(page.getByRole("dialog", { name: "Create Sales Order" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Create Sales Order" })).toBeHidden();
  await newOrderButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Create Sales Order" })).toBeVisible();
  await expect(page.getByRole("combobox").nth(0)).toBeEnabled();
  await page.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: "UAT Retailer" }).click();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "UAT Warehouse" }).click();
  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: /UAT Product/ }).click();
  await page.getByRole("button", { name: "Create draft order" }).click();

  await expect(page.getByText("SO-UAT-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  expect(createdOrder).not.toBeNull();
});
