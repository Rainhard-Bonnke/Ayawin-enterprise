import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  downloadGrnPdf,
  downloadPaymentReceiptPdf,
  downloadReceiptPdf,
  downloadVendorPaymentPdf,
} from "@/lib/api";

type ReceiptKind = "invoice-paid" | "payment" | "grn" | "vendor-payment";

type Props = {
  kind: ReceiptKind;
  receiptRef: string;
  grnId?: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  className?: string;
};

export function ReceiptPdfButton({
  kind,
  receiptRef: docRef,
  grnId,
  label = "Receipt",
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const { token } = useAuth();

  const download = async () => {
    if (!token) {
      toast.error("Sign in to download receipts");
      return;
    }
    try {
      if (kind === "invoice-paid") await downloadReceiptPdf(token, docRef);
      else if (kind === "payment") await downloadPaymentReceiptPdf(token, docRef);
      else if (kind === "grn" && grnId) await downloadGrnPdf(token, grnId, docRef);
      else if (kind === "vendor-payment") await downloadVendorPaymentPdf(token, docRef);
      toast.success(`${label} PDF downloaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download receipt PDF");
    }
  };

  return (
    <Button type="button" size={size} variant={variant} className={className} onClick={() => void download()}>
      <FileDown className="mr-1 h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
