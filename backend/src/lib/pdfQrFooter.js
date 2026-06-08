const QRCode = require('qrcode');

async function appendDocumentQr(doc, { verifyUrl, hash, label = 'Scan to verify authenticity' }) {
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 128 });
  const pageWidth = doc.page.width;
  const margin = doc.page.margins?.left ?? 48;
  const contentWidth = pageWidth - margin * 2;
  let qrY = doc.y + 20;
  if (qrY > doc.page.height - 120) {
    doc.addPage();
    qrY = margin + 20;
  }
  doc.moveTo(margin, qrY - 8).lineTo(pageWidth - margin, qrY - 8).strokeColor('#cccccc').stroke();
  doc.image(qrDataUrl, margin, qrY, { width: 64, height: 64 });
  doc.fontSize(7).font('Helvetica').fillColor('#555555');
  doc.text(label, margin + 72, qrY + 4, { width: contentWidth - 72 });
  if (hash) {
    doc.text(`Document hash: ${String(hash).slice(0, 20)}…`, margin + 72, qrY + 16, { width: contentWidth - 72 });
  }
  doc.text(verifyUrl, margin + 72, qrY + 28, { width: contentWidth - 72 });
  doc.fillColor('#000000');
  doc.y = qrY + 72;
}

module.exports = { appendDocumentQr };
