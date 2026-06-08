import * as XLSX from "xlsx";

type SheetInput = {
  name: string;
  rows: Record<string, unknown>[];
};

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet1";
}

export function exportWorkbook(filename: string, sheets: SheetInput[]) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const rows = sheet.rows?.length ? sheet.rows : [{ note: "No data for selected filters" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name));
  }

  XLSX.writeFile(workbook, filename, { bookType: "xlsx", compression: true });
}
