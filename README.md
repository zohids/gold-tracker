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

A Cloudflare Worker in `cloudflare-worker/` fetches CBU's page and USD rate at 06:00 UTC (11:00 Asia/Tashkent), then commits the daily snapshot to `public/data/history.json` using the GitHub Contents API. That commit triggers the GitHub Pages deployment workflow. Its protected `/check` endpoint tests CBU reachability without writing history. Each snapshot is keyed by its collection date in Uzbekistan time; the CBU publication date and time are preserved separately. A repeat run updates that collection day's row without creating duplicates.

### Set up the Cloudflare updater

1. Create or sign in to a Cloudflare account and install Node.js/npm if needed.
2. Create a fine-grained GitHub personal access token for this repository with **Contents: Read and write** permission. Keep the token private.
3. In Terminal, from the repository root, run:

   ```sh
   cd cloudflare-worker
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put MANUAL_TRIGGER_TOKEN
   npx wrangler deploy
   ```

   Paste the GitHub token when prompted. For `MANUAL_TRIGGER_TOKEN`, use a different random secret (on macOS, `openssl rand -hex 32` generates one). Save it so you can run the connection check below. The Worker is configured for this repository in `wrangler.toml`.
4. In the deploy output, copy the `workers.dev` URL. Open `<worker-url>/health`; it should return `{"ok":true,...}`.
5. Test CBU reachability before waiting for the scheduled run. In Terminal, run `curl -X POST -H 'Authorization: Bearer YOUR_MANUAL_TRIGGER_TOKEN' 'https://YOUR_WORKER_URL/check'`, replacing both placeholders. A successful response includes `"cbuReachable":true` and the CBU publication date. This check does not write history.
6. In Cloudflare, open the Worker’s **Settings → Triggers** and confirm the Cron Trigger is `0 6 * * *` (11:00 Asia/Tashkent). The next scheduled run writes history to GitHub; the resulting push deploys GitHub Pages.

The Cloudflare free Workers plan currently allows Cron Triggers and up to five triggers per account. The first deployment requires a GitHub token, and the CBU connection check must pass before this can replace the existing updater. If the check fails, the CBU route is also unreachable from Cloudflare and the scheduled updater will need to run on a different network.

## Source fields

The history preserves the bank publication date/time and all five weights (5, 10, 20, 50, and 100 grams), with selling price, buyback price for intact packaging, and buyback price for damaged packaging. The CBU page can revise prices during the day; this app takes its daily snapshot at 11:00 Uzbekistan time.

Each saved snapshot also stores the bank USD-to-UZS exchange rate effective on the gold price date (or the nearest previous published rate, for non-business days). The page shows USD equivalents beside every price using that saved rate.

## Publish with GitHub Pages

The repository includes a workflow that deploys the static site to GitHub Pages when `main` changes. The Cloudflare Worker handles the daily fetch and history commit.

1. Push the project to the repository's default branch.
2. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open **Settings → Actions → General** and ensure Actions are allowed. The Pages workflow only needs read access to the repository.
4. Push this workflow to GitHub, then open **Actions → Deploy Gold Tracker** and select **Run workflow** for the first deployment.
5. After the workflow succeeds, open the site URL shown under **Settings → Pages**.

Each successful Worker update pushes the changed history file to `main`, which redeploys the site.
