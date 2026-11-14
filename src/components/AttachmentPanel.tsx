import { useId, type ChangeEvent } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AttachmentItem = {
  id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256?: string;
  created_at?: string;
};

type AttachmentPanelProps<TAttachment extends AttachmentItem> = {
  attachments: TAttachment[];
  onUpload: (file: File) => void;
  onDownload: (attachment: TAttachment) => void;
  uploading?: boolean;
  maxFiles?: number;
  title?: string;
  description?: string;
};

const DEFAULT_DESCRIPTION = "JPEG, PNG, WebP or PDF · up to 5 MB each";

export function AttachmentPanel<TAttachment extends AttachmentItem>({
  attachments,
  onUpload,
  onDownload,
  uploading = false,
  maxFiles = 10,
  title = "Attachments",
  description = DEFAULT_DESCRIPTION,
}: AttachmentPanelProps<TAttachment>) {
  const inputId = useId();
  const atLimit = attachments.length >= maxFiles;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onUpload(file);
    event.currentTarget.value = "";
  };

  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label={`${title} panel`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <label
          htmlFor={inputId}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted ${
            uploading || atLimit ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {uploading ? "Uploading…" : "Add attachment"}
        </label>
        <input
          id={inputId}
          className="sr-only"
          aria-label="Add attachment"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={uploading || atLimit}
          onChange={handleFileChange}
        />
      </div>
      {attachments.length ? (
        <ul className="divide-y rounded-md border">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{attachment.file_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {(attachment.byte_size / 1024).toFixed(0)} KB
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Download ${attachment.file_name}`}
                onClick={() => onDownload(attachment)}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No attachments yet.</p>
      )}
      {atLimit && (
        <p className="text-xs text-muted-foreground">Maximum of {maxFiles} files reached.</p>
      )}
    </section>
  );
}
