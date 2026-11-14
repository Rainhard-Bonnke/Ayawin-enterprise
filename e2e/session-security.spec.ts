import { expect, test } from "@playwright/test";

function token() {
  const payload = Buffer.from(JSON.stringify({
    sub: "uat-sales-rep",
    email: "sales.rep@example.test",
    role_name: "Sales Rep",
    permissions: ["sales.order.create"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `test.${payload}.signature`;
}

const user = {
  id: "uat-sales-rep",
  email: "sales.rep@example.test",
  username: "sales.rep",
  role_name: "Sales Rep",
  permissions: ["sales.order.create"],
};

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(user.email);
  await page.getByLabel("Password").fill("uat-password");
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("login refreshes an expired access token and retries the request", async ({ page }) => {
  const access = token();
  let refreshCalls = 0;
  let orderReads = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (path === "/auth/csrf") {
      await route.fulfill({ json: { csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/refresh" && request.method() === "POST") {
      refreshCalls += 1;
      await route.fulfill(refreshCalls === 1
        ? { status: 401, json: { error: "No refresh session" } }
        : { json: { access_token: access, csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/login" && request.method() === "POST") {
      await route.fulfill({ json: { access_token: access, csrf_token: "uat-csrf-token", user } });
    } else if (path === "/auth/me") {
      await route.fulfill({ json: user });
    } else if (path === "/master/customers") {
      await route.fulfill({ json: { data: [] } });
    } else if (path === "/master/items") {
      await route.fulfill({ json: { data: [] } });
    } else if (path === "/master/warehouses") {
      await route.fulfill({ json: { data: [] } });
    } else if (path === "/sales/orders" && request.method() === "GET") {
      orderReads += 1;
      await route.fulfill(orderReads === 1
        ? { status: 401, json: { error: "Access token expired" } }
        : { json: [] });
    } else {
      await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${request.method()} ${path}` } });
    }
  });

  await signIn(page);
  await page.getByRole("link", { name: "Sales orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales & Orders" })).toBeVisible();
  await expect.poll(() => orderReads).toBe(2);
  expect(refreshCalls).toBe(2);
});

test("a sales user cannot open user administration", async ({ page }) => {
  const access = token();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (path === "/auth/csrf") {
      await route.fulfill({ json: { csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/refresh" && request.method() === "POST") {
      await route.fulfill({ json: { access_token: access, csrf_token: "uat-csrf-token" } });
    } else if (path === "/auth/login" && request.method() === "POST") {
      await route.fulfill({ json: { access_token: access, csrf_token: "uat-csrf-token", user } });
    } else if (path === "/auth/me") {
      await route.fulfill({ json: user });
    } else if (path === "/master/customers" || path === "/master/items" || path === "/master/warehouses") {
      await route.fulfill({ json: [] });
    } else if (path === "/sales/orders") {
      await route.fulfill({ json: [] });
    } else {
      await route.fulfill({ status: 403, json: { error: "Permission denied" } });
    }
  });

  await signIn(page);
  await expect(page.getByRole("link", { name: "Sales orders", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users & Roles" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByRole("heading", { name: "Sales & Orders" })).toBeVisible();
});
