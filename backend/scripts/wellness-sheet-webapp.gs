/**
 * Live Wellness grades sheet: receiver side.
 *
 * Paste into the Google Sheet's Extensions → Apps Script, set SECRET to the
 * same value as the backend's WELLNESS_SHEET_SECRET, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone)
 * and put the /exec URL in the backend's WELLNESS_SHEET_WEBAPP_URL.
 *
 * The backend (cron/wellnessSheetSync.cron.js) POSTs
 *   { secret, tabs: [{ title, values: string[][] }] }
 * and this script writes each tab. There is no doGet, so the URL can only
 * receive data, never hand it out.
 */
var SECRET = "PASTE_SECRET_HERE";

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return reply_({ ok: false, error: "busy" });
  try {
    var body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SECRET) return reply_({ ok: false, error: "unauthorized" });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var written = [];
    (body.tabs || []).forEach(function (tab) {
      written.push(writeTab_(ss, tab.title, tab.values));
    });
    return reply_({ ok: true, written: written });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function writeTab_(ss, title, values) {
  var height = values.length;
  var width = values.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
  var rows = values.map(function (r) {
    var out = r.slice();
    while (out.length < width) out.push("");
    return out;
  });
  var sheet = ss.getSheetByName(title) || ss.insertSheet(title);
  if (sheet.getMaxRows() < height) sheet.insertRowsAfter(sheet.getMaxRows(), height - sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var range = sheet.getRange(1, 1, height, width);
  range.setNumberFormat("@"); // plain text, so "0028" and "10" stay exactly as sent
  range.setValues(rows);
  // Clear what an earlier, larger write left below or to the right.
  if (sheet.getMaxRows() > height) sheet.getRange(height + 1, 1, sheet.getMaxRows() - height, sheet.getMaxColumns()).clearContent();
  if (sheet.getMaxColumns() > width) sheet.getRange(1, width + 1, height, sheet.getMaxColumns() - width).clearContent();
  if (height > 1) sheet.setFrozenRows(1);
  return { title: title, rows: height, columns: width };
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
