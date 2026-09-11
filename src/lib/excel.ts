type SheetInput = {
  name: string;
  rows: Record<string, unknown>[];
};

export async function exportWorkbook(filename: string, sheets: SheetInput[]) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }

  XLSX.writeFile(workbook, filename, { compression: true });
}
