# Gold Ledger

A small single-page tracker for the Central Bank of Uzbekistan's gold bar selling and buyback prices. It displays the official bar table, calculates an indicative 1g price from the 100g selling price, and keeps one daily snapshot in SQLite.

## Run locally

```sh
npm install
npm start
```

Open http://localhost:3000. The first daily row is created when the updater runs:

```sh
npm run update
```

Set `FETCH_ON_START=true` to refresh from CBU whenever the server starts. Set `DATABASE_PATH` to use a different SQLite file.

## Daily schedule

The GitHub Actions workflow runs at 06:00 UTC (11:00 in Uzbekistan, UTC+5), fetches the page, and commits the SQLite history file. Enable Actions for the repository and allow the workflow to write repository contents. GitHub scheduled workflows can start late during busy periods. The upsert key is the CBU publication date, so a repeat run updates that day's snapshot without creating duplicates.

## Source fields

The history preserves the CBU publication date/time and all five weights (5, 10, 20, 50, and 100 grams), with selling price, buyback price for intact packaging, and buyback price for damaged packaging. The CBU page can revise prices during the day; this app takes its daily snapshot at 11:00 Uzbekistan time.

Each saved snapshot also stores the CBU USD-to-UZS exchange rate effective on the gold price date (or the nearest previous published rate, for non-business days). The page shows USD equivalents beside every price using that saved rate.
