// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormDialog } from "./FormDialog";

describe("FormDialog", () => {
  it("renders a labeled form and submits through its handler", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <FormDialog
        open
        onOpenChange={() => undefined}
        title="Create record"
        description="Record details"
        submitLabel="Create"
        onSubmit={onSubmit}
      >
        <label htmlFor="record-name">Name</label>
        <input id="record-name" />
      </FormDialog>,
    );

    fireEvent.submit(screen.getByRole("form", { name: "Create record" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables dialog actions while submitting", () => {
    render(
      <FormDialog
        open
        onOpenChange={() => undefined}
        title="Create record"
        submitLabel="Create"
        submittingLabel="Saving"
        isSubmitting
        onSubmit={(event) => event.preventDefault()}
      >
        <p>Details</p>
      </FormDialog>,
    );

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
