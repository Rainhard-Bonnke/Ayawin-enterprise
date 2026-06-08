const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');

const MARGIN = 48;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function qty(n) {
  return Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

async function loadDeliveryContext(companyId, deliveryNo) {
  const dnResult = await pool.query(
    `SELECT d.*, so.order_no, c.name AS customer_name, c.tax_id AS customer_tax_id,
            c.address_line1 AS customer_address, c.city AS customer_city, c.phone AS customer_phone,
            w.name AS warehouse_name,
            e.first_name || ' ' || e.last_name AS driver_name,
            v.plate_no AS vehicle_plate
     FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     JOIN erp_customers c ON c.id = so.customer_id
     LEFT JOIN erp_warehouses w ON w.id = d.warehouse_id
     LEFT JOIN erp_employees e ON e.id = d.driver_id
     LEFT JOIN erp_vehicles v ON v.id = d.vehicle_id
     WHERE d.company_id = $1 AND d.delivery_no = $2 AND d.is_deleted = FALSE`,
    [companyId, deliveryNo],
  );
  if (!dnResult.rowCount) throw new Error('Delivery note not found');
  const delivery = dnResult.rows[0];

  const lines = await pool.query(
    `SELECT dnl.line_no, dnl.quantity, i.item_code, i.name AS item_name
     FROM erp_delivery_note_lines dnl
     JOIN erp_items i ON i.id = dnl.item_id
     WHERE dnl.delivery_note_id = $1
     ORDER BY dnl.line_no`,
    [delivery.id],
  );

  const companyResult = await pool.query(
    `SELECT c.name, c.legal_name, c.tax_registration_no, c.logo_url,
            b.address_line1, b.city, b.phone
     FROM erp_companies c
     LEFT JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ' AND b.is_deleted = FALSE
     WHERE c.id = $1`,
    [companyId],
  );

  return { delivery, lines: lines.rows, company: companyResult.rows[0] || { name: 'Ayawin Stock Solutions ERP' } };
}

async function renderDeliveryPdfBuffer({ companyId, deliveryNo }) {
  const { delivery, lines, company } = await loadDeliveryContext(companyId, deliveryNo);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let headerY = MARGIN;
    if (company.logo_url) {
      const logoPath = company.logo_url.startsWith('/')
        ? path.join(process.cwd(), company.logo_url.replace(/^\//, ''))
        : company.logo_url;
      try {
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, MARGIN, headerY, { fit: [56, 56] });
          headerY += 60;
        }
      } catch {
        /* skip logo */
      }
    }

    doc.fontSize(16).font('Helvetica-Bold').text(company.legal_name || company.name, MARGIN, MARGIN, { width: 280 });
    doc.fontSize(9).font('Helvetica').fillColor('#333333');
    const addr = [company.address_line1, company.city].filter(Boolean).join(', ');
    if (addr) doc.text(addr, MARGIN);
    if (company.phone) doc.text(`Tel: ${company.phone}`, MARGIN);
    if (company.tax_registration_no) doc.text(`PIN: ${company.tax_registration_no}`, MARGIN);

    doc.fillColor('#000000');
    doc.fontSize(13).font('Helvetica-Bold').text('DELIVERY NOTE', MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
    doc.fontSize(10).font('Helvetica').text(delivery.delivery_no, { align: 'right' });
    doc.text(`Sales order: ${delivery.order_no}`, { align: 'right' });
    doc.moveDown(0.8);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);

    doc.fontSize(10).font('Helvetica-Bold').text('Deliver To');
    doc.font('Helvetica').text(delivery.customer_name || '—');
    if (delivery.customer_phone) doc.text(`Tel: ${delivery.customer_phone}`);
    doc.text([delivery.customer_address, delivery.customer_city].filter(Boolean).join(', ') || '—');
    doc.moveDown(0.4);
    doc.text(`Delivery date: ${String(delivery.delivery_date || '').slice(0, 10)}`);
    doc.text(`Zone: ${delivery.delivery_zone || '—'}`);
    doc.text(`Warehouse: ${delivery.warehouse_name || '—'}`);
    if (delivery.driver_name) doc.text(`Driver: ${delivery.driver_name}`);
    if (delivery.vehicle_plate) doc.text(`Vehicle: ${delivery.vehicle_plate}`);
    doc.text(`Status: ${delivery.logistics_status || delivery.status}`);
    doc.moveDown(0.8);

    const col = { item: MARGIN, qty: MARGIN + 400, unit: MARGIN + 460 };
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Item', col.item);
    doc.text('Qty', col.qty, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#eeeeee').stroke();
    doc.moveDown(0.2);

    doc.font('Helvetica').fontSize(8);
    for (const line of lines) {
      if (doc.y > 700) doc.addPage();
      doc.text(`${line.item_code} — ${line.item_name}`, col.item, doc.y, { width: 380 });
      doc.text(qty(line.quantity), col.qty, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' });
      doc.moveDown(0.15);
    }

    doc.moveDown(1);
    doc.fontSize(9).text('Received by (signature): _________________________________');
    if (delivery.pod_signature) {
      doc.moveDown(0.3).text(`POD on file: ${delivery.pod_signature}`);
    }
    doc.moveDown(0.5).fontSize(7).fillColor('#666666').text('Goods received in good condition unless noted above.');
    doc.end();
  });
}

module.exports = { loadDeliveryContext, renderDeliveryPdfBuffer };
