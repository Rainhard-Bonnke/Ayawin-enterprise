const PDFDocument = require('pdfkit');
const { appendDocumentQr } = require('../lib/pdfQrFooter');
const { buildPayslipVerificationHash, buildVerifyUrl } = require('./documentVerificationService');

function money(n) {
  return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function renderPayslipPdf({ companyName, payslip, employee, run }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const period = String(run?.payroll_month || '').slice(0, 7);

    doc.fontSize(16).font('Helvetica-Bold').text(companyName || 'Ayawin Stock Solutions ERP');
    doc.fontSize(12).font('Helvetica').text('PAYSLIP — CONFIDENTIAL');
    doc.moveDown(0.5);
    doc.text(`Pay period: ${period}`);
    doc.text(`Run: ${run?.run_no || '—'}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Employee');
    doc.font('Helvetica');
    doc.text(`${employee?.first_name || ''} ${employee?.last_name || ''}`.trim());
    doc.text(`Code: ${employee?.employee_code || '—'}`);
    if (employee?.department) doc.text(`Department: ${employee.department}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Earnings');
    doc.font('Helvetica');
    const earnings = Array.isArray(payslip.earnings_detail) ? payslip.earnings_detail : [];
    if (earnings.length) {
      earnings.forEach((e) => doc.text(`${e.code}: ${money(e.amount)}`));
    } else {
      doc.text(`Gross pay: ${money(payslip.gross_pay)}`);
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Deductions');
    doc.font('Helvetica');
    const deductions = Array.isArray(payslip.deductions_detail)
      ? payslip.deductions_detail
      : typeof payslip.deductions_detail === 'string'
        ? JSON.parse(payslip.deductions_detail || '[]')
        : [];
    if (deductions.length) {
      deductions.forEach((d) => {
        const label = String(d.code || 'Deduction').replace(/_/g, ' ');
        doc.text(`${label}: ${money(d.amount)}`);
      });
    } else {
      doc.text(`PAYE: ${money(payslip.paye)}`);
      doc.text(`NHIF: ${money(payslip.nhif)}`);
      doc.text(`NSSF Tier I: ${money(payslip.nssf_tier1 ?? payslip.nssf)}`);
      if (Number(payslip.nssf_tier2) > 0) doc.text(`NSSF Tier II: ${money(payslip.nssf_tier2)}`);
      doc.text(`NSSF Total: ${money(payslip.nssf)}`);
      doc.text(`Housing Levy (1.5%): ${money(payslip.housing_levy)}`);
      if (Number(payslip.helb) > 0) doc.text(`HELB: ${money(payslip.helb)}`);
      if (Number(payslip.sacco) > 0) doc.text(`SACCO: ${money(payslip.sacco)}`);
      if (Number(payslip.loan_deduction) > 0) doc.text(`Loan: ${money(payslip.loan_deduction)}`);
      if (Number(payslip.other_deductions) > 0) doc.text(`Other: ${money(payslip.other_deductions)}`);
    }
    doc.moveDown();

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text(`NET PAY: ${money(payslip.net_pay)}`);
    doc.moveDown(0.6);
    doc.fontSize(9).font('Helvetica').fillColor('#666666');
    doc.text('This payslip is system-generated. Statutory amounts use Kenya 2024 configuration.');

    const verifyHash = buildPayslipVerificationHash(payslip, run);
    const verifyUrl = buildVerifyUrl(
      `/api/v1/payroll/runs/${run?.id || payslip.payroll_run_id}/payslips/${payslip.id}/verify`,
      verifyHash,
    );
    appendDocumentQr(doc, { verifyUrl, hash: verifyHash, label: 'Scan to verify payslip' })
      .then(() => doc.end())
      .catch(reject);
  });
}

module.exports = { renderPayslipPdf };
