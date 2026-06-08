/** Minimal RFC4180-style CSV parser (no external deps). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r') i += 1;
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

function csvToObjects(text) {
  const table = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!table.length) return [];
  const headers = table[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return table.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const raw = cells[idx] ?? '';
      if (h.includes('limit') || h.includes('cost') || h.includes('price') || h.includes('litres')) {
        obj[h] = raw === '' ? undefined : Number(raw);
      } else {
        obj[h] = raw;
      }
    });
    return obj;
  });
}

module.exports = { parseCsv, csvToObjects };
