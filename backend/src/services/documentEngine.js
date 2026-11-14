const PDFDocument = require("pdfkit");

function buildQrPayload({ type, id, verificationUrl }) {
  return verificationUrl || `${type}:${id}`;
}

function renderDocumentPdf({
  company,
  documentType,
  title,
  number,
  issuedAt,
  status = "DRAFT",
  parties = {},
  lines = [],
  totals = {},
  notes = "",
  preparedBy = "",
  approvedBy = "",
  qrUrl = "",
}) {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: false });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(company?.name || "Ayawin ERP", { align: "left" });
    doc.fontSize(10).fillColor("#475467").text(company?.taxRegistrationNo ? `KRA PIN: ${company.taxRegistrationNo}` : "KRA PIN: N/A");
    doc.moveDown(0.3);
    doc.text(company?.address || "");
    doc.text(company?.contacts || "");

    doc.moveDown(0.8);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111827").text(title || documentType || "Document");
    doc.fontSize(10).font("Helvetica").text(`Document No: ${number || "N/A"}`);
    doc.text(`Date: ${issuedAt || new Date().toISOString().slice(0, 10)}`);
    doc.text(`Status: ${status.toUpperCase()}`);

    const watermarked = status && status.toUpperCase() !== "POSTED" && status.toUpperCase() !== "APPROVED";
    if (watermarked) {
      doc.save();
      doc.rotate(-20, { origin: [230, 300] });
      doc.fillColor("rgba(95, 99, 112, 0.12)").fontSize(42).text("DRAFT", { align: "center" });
      doc.restore();
    }

    doc.moveDown(1);
    doc.fontSize(9).font("Helvetica-Bold").text("Customer / Supplier");
    doc.fontSize(9).font("Helvetica").text(parties?.name || "");
    doc.text(parties?.contact || "");
    doc.text(parties?.email || "");

    doc.moveDown(1);
    doc.fontSize(10).font("Helvetica-Bold").text("Line items");
    let y = doc.y;
    lines.forEach((line) => {
      if (y > 700) {
        doc.addPage();
        y = 60;
      }
      doc.fontSize(8).font("Helvetica");
      doc.text(`${line.description || "Item"}  ${line.quantity || 0} x ${line.unitPrice || 0}`, { continued: true });
      doc.text(`   ${line.amount || 0}`, { align: "right" });
      y = doc.y + 8;
    });

    doc.moveDown(1.2);
    doc.fontSize(9).font("Helvetica-Bold").text("Totals");
    doc.fontSize(9).font("Helvetica").text(`Subtotal: ${Number(totals.subtotal || 0).toFixed(2)}`);
    doc.text(`VAT: ${Number(totals.tax || 0).toFixed(2)}`);
    doc.text(`Total: ${Number(totals.total || 0).toFixed(2)}`);

    if (notes) {
      doc.moveDown(1.1);
      doc.fontSize(9).font("Helvetica-Bold").text("Notes");
      doc.fontSize(9).font("Helvetica").text(String(notes));
    }

    doc.moveDown(1.1);
    doc.fontSize(9).font("Helvetica-Bold").text("Prepared by");
    doc.text(preparedBy || "");
    doc.text(`Approved by: ${approvedBy || ""}`);

    if (qrUrl) {
      const qrcode = require("qrcode");
      const payload = buildQrPayload({ type: documentType, id: number, verificationUrl: qrUrl });
      qrcode.toString(payload, { type: "terminal", small: true }, (error, code) => {
        if (!error) {
          doc.moveDown(1);
          doc.fontSize(8).font("Helvetica-Bold").text("Verification QR payload");
          doc.fontSize(7).font("Courier").text(code || payload);
        }
        doc.end();
      });
      return;
    }

    doc.end();
  });
}

module.exports = {
  renderDocumentPdf,
  buildQrPayload,
};
