// Sends tabs of values to the Google Sheet's Apps Script web app
// (scripts/wellness-sheet-webapp.gs), which writes them into the sheet.
// Apps Script answers a POST with a 302 to the script output; fetch follows it
// with a GET, which returns doPost's JSON reply.

/**
 * @param {string} url the web app's /exec URL
 * @param {string} secret shared with the script's SECRET
 * @param {{ title: string, values: string[][] }[]} tabs
 */
export const postTabsToSheet = async (url, secret, tabs) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, tabs }),
    redirect: "follow"
  });
  const text = await res.text();
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new Error(`Sheet web app returned ${res.status} non-JSON (check the URL and that it is deployed for "Anyone"): ${text.slice(0, 200)}`);
  }
  if (!reply.ok) throw new Error(`Sheet web app refused: ${reply.error}`);
  return reply.written;
};
