# Gold Ledger

A small single-page tracker for the Central Bank's gold bar selling and buyback prices. It displays the official bar table, calculates an indicative 1g price from the 100g selling price, and keeps one daily snapshot in SQLite.

## Run locally

```sh
npm install
npm start
```

Open http://localhost:3000. The first daily row is created when the updater runs:

```sh
npm run update
```

Set `FETCH_ON_START=true` to refresh from bank whenever the server starts. Set `DATABASE_PATH` to use a different SQLite file.

## Daily schedule

The GitHub Actions workflow runs at 06:00 UTC (11:00 UTC+5), fetches the page, and commits the SQLite history file and static JSON archive. Enable Actions for the repository and allow the workflow to write repository contents. GitHub scheduled workflows can start late during busy periods. The snapshot date is the collection date in Uzbekistan time; a repeat run updates that day's snapshot without creating duplicates, while the CBU publication timestamp is preserved separately.

## Source fields

The history preserves the bank publication date/time and all five weights (5, 10, 20, 50, and 100 grams), with selling price, buyback price for intact packaging, and buyback price for damaged packaging. The CBU page can revise prices during the day; this app takes its daily snapshot at 11:00 Uzbekistan time.

Each saved snapshot also stores the bank USD-to-UZS exchange rate effective on the gold price date (or the nearest previous published rate, for non-business days). The page shows USD equivalents beside every price using that saved rate.

## Publish with GitHub Pages

The repository includes a workflow that fetches prices at 11:00 Asia/Tashkent, exports the history to public/data/history.json, and deploys the static site to GitHub Pages.

1. Push the project to the repository's default branch.
2. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open **Settings → Actions → General** and ensure Actions are allowed. Under **Workflow permissions**, select **Read and write permissions** so the scheduled workflow can commit updated price history.
4. Push this workflow to GitHub, then open **Actions → Update prices and publish site** and select **Run workflow** for the first deployment.
5. After the workflow succeeds, open the site URL shown under **Settings → Pages**.

The scheduled workflow also redeploys the site after each daily update. Scheduled workflows may start late during busy periods.
