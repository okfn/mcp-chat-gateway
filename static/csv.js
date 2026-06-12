// CSV serialization, shared by the table message downloads (chat.js) and the
// chart data export (chart-export-data.js). Serialization only -- triggering
// the actual browser download lives in download.js.
//
// Exposes window.CSVExport = { toCSV, toExcelCSV }.

(function () {
  // Serialize rows (arrays of cells, first row = header) to RFC 4180 CSV.
  //
  // We deliberately stick to the standard: UTF-8 with no BOM, comma delimiter,
  // CRLF line endings. This is correct, portable CSV. It may NOT open cleanly in
  // Excel on Windows, which (a) assumes the legacy system codepage without a BOM,
  // so accented chars (Spanish/Portuguese) garble, and (b) uses the locale "list
  // separator" (often ";" in es/pt locales) instead of "," to split columns.
  // That's an Excel/Windows quirk, not a bug here -- standards win.
  //
  // `delim` defaults to "," (the standard). A cell is quoted when it contains the
  // delimiter, a quote, or a line break, so changing the delimiter stays safe.
  function toCSV(rows, delim) {
    delim = delim || ",";
    const needsQuote = new RegExp('["\r\n' + delim + ']');
    const escape = (cell) => {
      const s = cell == null ? "" : String(cell);
      return needsQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map((row) => row.map(escape).join(delim)).join("\r\n");
  }

  // Excel/Windows-flavored CSV. Two NON-STANDARD choices make Excel open it
  // correctly on a double-click, without the ugly "sep=" preamble:
  //   1. A UTF-8 BOM (U+FEFF) so Excel detects UTF-8 instead of the legacy
  //      system codepage -- keeps Spanish/Portuguese accents from garbling.
  //      (Invisible inside Excel; only dumb text viewers show it.)
  //   2. A semicolon delimiter, which is the default "list separator" Excel uses
  //      in es/pt locales -- so columns split correctly with no hint line.
  function toExcelCSV(rows) {
    return "\uFEFF" + toCSV(rows, ";");
  }

  window.CSVExport = { toCSV, toExcelCSV };
})();
