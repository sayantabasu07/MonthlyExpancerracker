# Pocket Ledger

Pocket Ledger is a small, installable expense tracker designed for Android phones. It runs as a Progressive Web App (PWA): open it in Chrome, then choose **Add to Home screen** to use it like an app. No account or network connection is needed after the first load.

## MVP features

- Monthly dashboard with spending total, budget progress, category breakdown, and recent expenses.
- Three-month spending comparison based on the selected dashboard month.
- Add, edit, and delete expenses with a title, amount, category, date, and optional note.
- Add custom transaction categories in Settings.
- Import prior expenses from `.xlsx`, `.xls`, or `.csv` spreadsheets.
- Browse and filter transaction history by month and category.
- Set a monthly budget and choose a currency.
- Export expenses as CSV.
- Offline app shell and on-device persistence.

## Run locally

The app is static and has no package installation step. Serve this folder over HTTP; service workers and install prompts do not work from a `file://` URL.

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser. For Android, put the computer and phone on the same network, serve on an accessible address, and open the computer's LAN URL in Chrome. For a production install prompt, host the files over HTTPS.

## Android install

1. Open the hosted app URL in Chrome on Android.
2. Open Chrome's menu and tap **Add to Home screen** or **Install app**.
3. Launch Pocket Ledger from the new home-screen icon.

## Use

Choose **Add expense** to record a purchase. Use **Edit** beside a transaction in its history row to update it. Add custom transaction categories, update the budget and display currency, or import a spreadsheet in **Settings**. The app defaults to INR; other currencies remain available in Settings. Dashboard and history totals follow the selected month. The dashboard comparison shows that month and the two months before it. Download the example Excel workbook there to use as a template; replace or remove its sample rows before importing. The first worksheet must have a header row with `Date`, `Amount`, and `Description` or `Title`; `Category` and `Note` are optional. Dates should be Excel dates, ISO (`YYYY-MM-DD`), or day-first (`DD/MM/YYYY`). Re-imported exact matching rows are skipped. The history screen's export button downloads all saved expenses as CSV. Use **Clear all data** in Settings to remove local records and reset preferences.

## Architecture and data

- `index.html`, `styles.css`, and `app.js` implement the interface and client-side behavior without a framework or build step.
- `manifest.webmanifest` provides install metadata; `sw.js` caches the static app shell and local spreadsheet parser for offline use.
- `vendor/xlsx.full.min.js` is the SheetJS Community Edition browser parser; its Apache-2.0 license is included alongside it.
- Expenses and preferences are stored as JSON in the browser's private on-device file system (`pocket-ledger-data.json`), with a `localStorage` recovery mirror. Nothing is sent to a server. Browsers without private file-system support fall back to browser storage.
- The app is designed for one device and one user. **Clear all data** clears the saved JSON data and recovery mirror. Clearing the browser's site data also removes the app's private file.

## Scope and limitations

This MVP does not include bank connections, accounts or synchronization, recurring expenses, receipt scanning, shared budgets, or financial advice. It is not a native APK. HTTPS is required for installability and offline service-worker behavior outside localhost. Treat exported CSV files as sensitive financial data.