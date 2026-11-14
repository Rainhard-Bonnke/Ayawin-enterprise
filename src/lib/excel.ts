type SheetInput = {
  name: string;
  rows: Record<string, unknown>[];
};

export async function exportWorkbook(filename: string, sheets: SheetInput[]) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    const columns = Array.from(new Set(sheet.rows.flatMap((row) => Object.keys(row))));
    worksheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(40, Math.max(12, key.length + 2)),
    }));
    worksheet.addRows(sheet.rows);
  }

  const contents = await workbook.xlsx.writeBuffer();
  const file = new Blob([contents as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
