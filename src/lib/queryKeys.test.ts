import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";

describe("domain query key factories", () => {
  it("keeps filtered documents distinct and scoped to their domain", () => {
    expect(queryKeys.documents.list("invoice", { status: "posted" })).toEqual([
      "documents",
      "invoice",
      { status: "posted" },
    ]);
    expect(queryKeys.documents.list("invoice", { status: "draft" })).not.toEqual(
      queryKeys.documents.list("invoice", { status: "posted" }),
    );
  });

  it("separates each user's sales order cache", () => {
    expect(queryKeys.sales.orders("user-a")).not.toEqual(queryKeys.sales.orders("user-b"));
  });

  it("provides separate inventory keys for material issue registers", () => {
    expect(queryKeys.inventory.materialIssues()).not.toEqual(
      queryKeys.inventory.materialRequisitions(),
    );
  });

  it("keeps the transfer register in its own inventory cache", () => {
    expect(queryKeys.inventory.transfers()).toEqual(["inventory", "transfers"]);
  });

  it("keeps material returns separate from material issues", () => {
    expect(queryKeys.inventory.materialReturns()).toEqual(["inventory", "material-returns"]);
  });

  it("uses an explicit inventory key for quarantine stock", () => {
    expect(queryKeys.inventory.quarantine()).toEqual(["inventory", "quarantine"]);
  });

  it("separates lot lists by expired-lot visibility", () => {
    expect(queryKeys.inventory.lots(true)).not.toEqual(queryKeys.inventory.lots(false));
  });

  it("scopes customer credit note queries to their register", () => {
    expect(queryKeys.sales.customerCreditNotes()).toEqual(["sales", "customer-credit-notes"]);
  });

  it("scopes supplier credit note queries to their register", () => {
    expect(queryKeys.procurement.supplierCredits()).toEqual(["procurement", "supplier-credits"]);
  });

  it("keeps dashboard data scoped to the signed-in user", () => {
    expect(queryKeys.dashboard.summary("u1")).not.toEqual(queryKeys.dashboard.summary("u2"));
  });

  it("keeps stock analyses distinct by period and warehouse", () => {
    expect(queryKeys.inventory.analysis(30, "all")).not.toEqual(
      queryKeys.inventory.analysis(90, "all"),
    );
  });

  it("keys route closures by business date and active user", () => {
    expect(queryKeys.sales.routeClosures("2026-11-12", "driver-1")).not.toEqual(
      queryKeys.sales.routeClosures("2026-11-12", "driver-2"),
    );
  });

  it("separates the inventory findings register from stock totals", () => {
    expect(queryKeys.inventory.findings()).not.toEqual(queryKeys.inventory.workspace());
  });

  it("scopes delivery lists to the signed-in user", () => {
    expect(queryKeys.deliveries.list("driver")).not.toEqual(queryKeys.deliveries.list("manager"));
  });

  it("separates stock adjustment registers from warehouse count setup", () => {
    expect(queryKeys.inventory.adjustments()).not.toEqual(queryKeys.inventory.countSetup());
  });

  it("scopes self-service data to the employee session", () => {
    expect(queryKeys.hr.selfService("employee-a")).not.toEqual(
      queryKeys.hr.selfService("employee-b"),
    );
  });

  it("keys POS catalog and tax preview separately from stock reporting", () => {
    expect(
      queryKeys.sales.posTaxPreview([{ item_id: "a", quantity: 1, unit_price: 2 }], "2026-11-12"),
    ).not.toEqual(
      queryKeys.sales.posTaxPreview([{ item_id: "a", quantity: 2, unit_price: 2 }], "2026-11-12"),
    );
    expect(queryKeys.inventory.posCatalog("juice")).not.toEqual(
      queryKeys.inventory.posCatalog("water"),
    );
    expect(queryKeys.inventory.posSetup()).toEqual(["inventory", "pos-setup"]);
  });

  it("separates procurement order and receipt registers", () => {
    expect(queryKeys.procurement.orders()).not.toEqual(queryKeys.procurement.goodsReceipts());
  });

  it("keys draft invoice tax previews by date and lines", () => {
    expect(
      queryKeys.invoices.taxPreview(
        [{ item_id: "item-1", quantity: 1, unit_price: 100 }],
        "2026-11-12",
      ),
    ).not.toEqual(
      queryKeys.invoices.taxPreview(
        [{ item_id: "item-1", quantity: 2, unit_price: 100 }],
        "2026-11-12",
      ),
    );
  });

  it("keeps driver stock workspaces scoped to the active driver", () => {
    expect(queryKeys.inventory.driverWorkspace("driver-a")).not.toEqual(
      queryKeys.inventory.driverWorkspace("driver-b"),
    );
  });

  it("separates bank reconciliation detail from the register", () => {
    expect(queryKeys.finance.bankReconciliation("session-a")).not.toEqual(
      queryKeys.finance.bankReconciliation("session-b"),
    );
  });

  it("keeps master data caches separate by selected register", () => {
    expect(queryKeys.masterData.list("items")).not.toEqual(queryKeys.masterData.list("tax"));
  });

  it("groups deployment settings under one user scoped workspace key", () => {
    expect(queryKeys.settings.workspace("admin-a")).not.toEqual(
      queryKeys.settings.workspace("admin-b"),
    );
  });

  it("separates roles and security policy queries by user", () => {
    expect(queryKeys.users.roles("admin-a")).not.toEqual(queryKeys.users.roles("admin-b"));
    expect(queryKeys.users.security("admin-a")).not.toEqual(queryKeys.users.security("admin-b"));
  });

  it("scopes the sales order entry catalog separately from order registers", () => {
    expect(queryKeys.sales.orderFormSetup("user-a")).not.toEqual(
      queryKeys.sales.orderFormSetup("user-b"),
    );
    expect(queryKeys.sales.orderFormSetup()).not.toEqual(queryKeys.sales.orders());
  });

  it("keys finance workspaces by period and user", () => {
    expect(queryKeys.accounting.workspace("admin", "period-a")).not.toEqual(
      queryKeys.accounting.workspace("admin", "period-b"),
    );
    expect(queryKeys.accounting.snapshot("admin")).not.toEqual(
      queryKeys.accounting.snapshot("other"),
    );
  });

  it("separates HR employee, attendance, and payroll detail caches", () => {
    expect(queryKeys.hr.employees("u1")).not.toEqual(queryKeys.hr.attendance("u1"));
    expect(queryKeys.hr.payrollDetail("run-a")).not.toEqual(queryKeys.hr.payrollDetail("run-b"));
  });

  it("keeps recruitment and onboarding caches separate from payroll data", () => {
    expect(queryKeys.hr.recruitmentOverview()).not.toEqual(queryKeys.hr.payrollRuns());
    expect(queryKeys.hr.employeeOnboarding("emp-1")).not.toEqual(
      queryKeys.hr.employeeDocuments("emp-2"),
    );
  });

  it("scopes invoice creation setup to the current user", () => {
    expect(queryKeys.invoices.createSetup("u1")).not.toEqual(queryKeys.invoices.createSetup("u2"));
  });
});
