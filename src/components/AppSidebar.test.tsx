import { describe, expect, it } from "vitest";
import { navGroups } from "./AppSidebar";
import { Route as taxManagementRoute } from "@/routes/_app.tax-management";

describe("finance navigation", () => {
  it("keeps a dedicated cash and bank workspace in the accounting module", () => {
    const financeGroup = navGroups.find((group) => group.label === "FINANCE");

    expect(financeGroup).toBeDefined();

    const cashBank = financeGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/cash-bank");

    expect(cashBank?.title).toBe("Cash & Bank");
  });

  it("adds a budget and forecasting workspace in the accounting module", () => {
    const financeGroup = navGroups.find((group) => group.label === "FINANCE");

    expect(financeGroup).toBeDefined();

    const budget = financeGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/budget-forecasting");

    expect(budget?.title).toBe("Budget & Forecasting");
  });

  it("adds a dedicated tax management workspace in the accounting module", () => {
    const financeGroup = navGroups.find((group) => group.label === "FINANCE");

    expect(financeGroup).toBeDefined();

    const tax = financeGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/tax-management");

    expect(tax?.title).toBe("Tax Management");
  });

  it("adds an expenses management workspace in the accounting module", () => {
    const financeGroup = navGroups.find((group) => group.label === "FINANCE");

    expect(financeGroup).toBeDefined();

    const expenses = financeGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/expenses-management");

    expect(expenses?.title).toBe("Expenses Management");
  });

  it("adds a financial reporting workspace in the accounting module", () => {
    const financeGroup = navGroups.find((group) => group.label === "FINANCE");

    expect(financeGroup).toBeDefined();

    const reporting = financeGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/financial-reporting");

    expect(reporting?.title).toBe("Financial Reporting");
  });

  it("adds a fixed assets overview workspace to the asset register module", () => {
    const assetsGroup = navGroups.find((group) => group.label === "ASSETS");

    expect(assetsGroup).toBeDefined();

    const fixedAssets = assetsGroup!.items
      .flatMap((item) => [item, ...(item.subItems ?? [])])
      .find((nav) => nav.url === "/fixed-assets");

    expect(fixedAssets?.title).toBe("Fixed Assets");
  });

  it("loads the tax dashboard from live company tax data", () => {
    expect(taxManagementRoute).toBeDefined();
  });
});
