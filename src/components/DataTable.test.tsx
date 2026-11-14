// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";
import { exportWorkbook } from "@/lib/excel";

vi.mock("@/lib/excel", () => ({ exportWorkbook: vi.fn().mockResolvedValue(undefined) }));

type Row = { id: string; name: string; amount: number };

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount", align: "right" },
];

const rows: Row[] = [
  { id: "1", name: "Mango", amount: 20 },
  { id: "2", name: "Cola", amount: 10 },
  { id: "3", name: "Water", amount: 30 },
];

beforeEach(() => {
  window.history.replaceState({}, "", "/inventory");
  vi.mocked(exportWorkbook).mockClear();
});

afterEach(cleanup);

describe("DataTable", () => {
  it("filters rows and stores the filter in the URL", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} exportFilename="records.xlsx" />);

    await user.type(screen.getByRole("searchbox", { name: "Search records" }), "Mango");

    expect(screen.getByText("Mango")).toBeInTheDocument();
    expect(screen.queryByText("Cola")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Mango");
  });

  it("sorts a column and exposes the sort direction accessibly", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} exportFilename="records.xlsx" />);

    await user.click(screen.getByRole("button", { name: "Sort by Amount" }));

    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("10")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("hides optional columns through the column chooser", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} exportFilename="records.xlsx" />);

    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Amount" }));

    expect(screen.queryByRole("columnheader", { name: /Amount/ })).not.toBeInTheDocument();
    expect(screen.getByText("Mango")).toBeInTheDocument();
  });

  it("exports every filtered row using visible columns", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} exportFilename="records.xlsx" />);
    await user.type(screen.getByRole("searchbox", { name: "Search records" }), "Cola");
    await user.click(screen.getByRole("button", { name: "Export records" }));

    await waitFor(() =>
      expect(exportWorkbook).toHaveBeenCalledWith("records.xlsx", [
        {
          name: "Records",
          rows: [{ Name: "Cola", Amount: 10 }],
        },
      ]),
    );
  });

  it("paginates with the page index in the URL", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/inventory?page=1");
    render(<DataTable columns={columns} rows={rows} pageSize={2} exportFilename="records.xlsx" />);

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.queryByText("Mango")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
  });

  it("shows loading, error, and empty states", () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} loading exportFilename="records.xlsx" />,
    );
    expect(screen.getByText("Loading records…")).toBeInTheDocument();

    rerender(
      <DataTable
        columns={columns}
        rows={[]}
        error="Network unavailable"
        onRetry={() => undefined}
        exportFilename="records.xlsx"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable");

    rerender(<DataTable columns={columns} rows={[]} exportFilename="records.xlsx" />);
    expect(screen.getByText("No records yet.")).toBeInTheDocument();
  });
});
