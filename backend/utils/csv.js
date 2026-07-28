const escapeCell = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value).replace(/"/g, '""');
  return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
};

export const toCsv = (rows) => {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))
  ];

  // Excel (Windows) ignores the "Content-Type: text/csv; charset=utf-8"
  // response header when a downloaded CSV is opened by double-click —
  // without a UTF-8 byte-order-mark at the very start of the file, it falls
  // back to the system codepage (Windows-1252), turning any non-ASCII
  // character (e.g. a name with a diacritic, or an em dash) into mojibake
  // like "â€"". The BOM is what tells Excel specifically to decode the rest
  // of the file as UTF-8 — most other tools ignore it or already assume UTF-8.
  return "﻿" + lines.join("\n");
};

export const parseCsv = (content) => {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length || currentRow.length) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) =>
      headers.reduce((result, header, index) => {
        result[header] = row[index] ?? "";
        return result;
      }, {})
    );
};
