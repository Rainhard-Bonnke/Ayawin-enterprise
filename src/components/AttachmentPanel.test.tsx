// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentPanel, type AttachmentItem } from "./AttachmentPanel";

const attachment: AttachmentItem = {
  id: "file-1",
  file_name: "signed-delivery.pdf",
  content_type: "application/pdf",
  byte_size: 2048,
  created_at: "2026-11-13T10:00:00Z",
};

afterEach(cleanup);

describe("AttachmentPanel", () => {
  it("lists files and delegates downloads by attachment id", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <AttachmentPanel
        attachments={[attachment]}
        onUpload={() => undefined}
        onDownload={onDownload}
      />,
    );

    expect(screen.getByText("signed-delivery.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download signed-delivery.pdf" }));
    expect(onDownload).toHaveBeenCalledWith(attachment);
  });

  it("delegates selected file uploads and resets the input", () => {
    const onUpload = vi.fn();
    const file = new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" });
    render(<AttachmentPanel attachments={[]} onUpload={onUpload} onDownload={() => undefined} />);

    const input = screen.getByLabelText("Add attachment") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("disables uploads while busy or at the file limit", () => {
    render(
      <AttachmentPanel
        attachments={Array.from({ length: 10 }, (_, index) => ({
          ...attachment,
          id: `file-${index}`,
          file_name: `proof-${index}.pdf`,
        }))}
        onUpload={() => undefined}
        onDownload={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Add attachment")).toBeDisabled();
    expect(screen.getByText("Maximum of 10 files reached.")).toBeInTheDocument();
  });
});
