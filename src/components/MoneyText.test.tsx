// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyText } from "./MoneyText";

describe("MoneyText", () => {
  it("formats KES values to two decimal places", () => {
    render(<MoneyText value="1234.5" />);
    expect(screen.getByText("KES 1,234.50")).toBeInTheDocument();
  });

  it("renders an em dash for missing values", () => {
    render(<MoneyText value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
