import express from 'express';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'gold-prices.sqlite'));
const SOURCE_URL = 'https://cbu.uz/en/banknotes-coins/gold-bars/prices/';
const FX_URL = 'https://cbu.uz/en/arkhiv-kursov-valyut/json/USD';
const TIME_ZONE = 'Asia/Tashkent';

db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS price_history (
  date TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  bars_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
)`);
const columns = db.prepare('PRAGMA table_info(price_history)').all().map((column) => column.name);
if (!columns.includes('usd_rate')) db.exec('ALTER TABLE price_history ADD COLUMN usd_rate REAL');
if (!columns.includes('usd_rate_date')) db.exec('ALTER TABLE price_history ADD COLUMN usd_rate_date TEXT');

const insertSnapshot = db.prepare(`INSERT INTO price_history (date, published_at, bars_json, source_url, fetched_at, usd_rate, usd_rate_date)
  VALUES (@date, @publishedAt, @barsJson, @sourceUrl, @fetchedAt, @usdRate, @usdRateDate)
  ON CONFLICT(date) DO UPDATE SET published_at=excluded.published_at, bars_json=excluded.bars_json,
    source_url=excluded.source_url, fetched_at=excluded.fetched_at, usd_rate=excluded.usd_rate,
    usd_rate_date=excluded.usd_rate_date`);

function parsePrice(text) {
  const n = Number(text.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseCbuPage(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\u00a0/g, ' ');
  const update = text.match(/Update date:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}),\s*(\d{2}:\d{2})/i);
  const dateMatch = text.match(/Update date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i);
  const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  if (!update || !dateMatch) throw new Error('Could not find the CBU update date');
  const date = `${dateMatch[3]}-${months[dateMatch[2]]}-${dateMatch[1].padStart(2, '0')}`;
  const bars = [];
  $('tr').each((_index, row) => {
    const cells = $(row).find('td').map((_cellIndex, cell) => $(cell).text().replace(/\u00a0/g, ' ').trim()).get();
    const weight = cells[0]?.match(/^(5|10|20|50|100)\s*grams?$/i);
    if (!weight || cells.length < 4) return;
    bars.push({
      weight: Number(weight[1]),
      selling: parsePrice(cells[1]),
      buybackIntact: parsePrice(cells[2]),
      buybackDamaged: parsePrice(cells[3]),
    });
  });
  if (bars.length !== 5 || bars.some((bar) => !bar.selling || !bar.buybackIntact || !bar.buybackDamaged)) {
    throw new Error(`Expected five complete gold bar rows; found ${bars.length}`);
  }
  return { date, publishedAt: `${date}T${update[2]}:00+05:00`, bars };
}

export async function fetchUsdRate(date) {
  const day = new Date(`${date}T12:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const requestDay = new Date(day);
    requestDay.setUTCDate(day.getUTCDate() - offset);
    const requestedDate = requestDay.toISOString().slice(0, 10);
    const response = await fetch(`${FX_URL}/USD/${requestedDate}/`);
    if (!response.ok) throw new Error(`CBU currency API returned HTTP ${response.status}`);
    const rates = await response.json();
    const usd = rates.find((entry) => entry.Ccy === 'USD');
    const rate = Number(usd?.Rate);
    if (rate > 0) {
      const [dayPart, month, year] = usd.Date.split('.');
      return { rate, date: `${year}-${month}-${dayPart}` };
    }
  }
  throw new Error(`Could not find a CBU USD rate for ${date} or the preceding six days`);
}

export async function refreshPrices() {
  const response = await fetch(SOURCE_URL, { headers: { 'user-agent': 'GoldTracker/1.0 (daily public price archive)' } });
  if (!response.ok) throw new Error(`CBU returned HTTP ${response.status}`);
  const parsed = parseCbuPage(await response.text());
  const usd = await fetchUsdRate(parsed.date);
  insertSnapshot.run({
    date: parsed.date,
    publishedAt: parsed.publishedAt,
    barsJson: JSON.stringify(parsed.bars),
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    usdRate: usd.rate,
    usdRateDate: usd.date,
  });
  return parsed;
}

function snapshot(row) {
  return { date: row.date, publishedAt: row.published_at, bars: JSON.parse(row.bars_json),
    usdRate: row.usd_rate, usdRateDate: row.usd_rate_date,
    sourceUrl: row.source_url, fetchedAt: row.fetched_at };
}

export function getPriceHistory() {
  return db.prepare('SELECT * FROM price_history ORDER BY date DESC').all().map(snapshot);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/history', (_req, res) => {
  res.json(getPriceHistory());
});
app.get('/api/current', (_req, res) => {
  res.json(getPriceHistory()[0] || null);
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Gold Tracker listening on http://localhost:${port} (${TIME_ZONE})`));
  if (process.env.FETCH_ON_START === 'true') {
    refreshPrices().then((data) => console.log(`Saved CBU prices for ${data.date}`))
      .catch((error) => console.error('Initial CBU refresh failed:', error));
  }
}
