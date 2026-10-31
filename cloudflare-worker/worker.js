const SOURCE_URL = 'https://cbu.uz/en/banknotes-coins/gold-bars/prices/';
const FX_URL = 'https://cbu.uz/en/arkhiv-kursov-valyut/json/USD';
const GITHUB_API = 'https://api.github.com';
const TIME_ZONE = 'Asia/Tashkent';
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, init = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      const delay = 1_500 * (2 ** (attempt - 1));
      console.warn(`Fetch failed (${attempt}/${MAX_ATTEMPTS}); retrying in ${delay} ms: ${error.message}`);
      await sleep(delay);
      continue;
    }

    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) {
      return response;
    }

    const delay = 1_500 * (2 ** (attempt - 1));
    console.warn(`HTTP ${response.status} (${attempt}/${MAX_ATTEMPTS}); retrying in ${delay} ms`);
    await response.body?.cancel();
    await sleep(delay);
  }
  throw new Error('Fetch retries exhausted');
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_match, value) => String.fromCodePoint(parseInt(value, 16)));
}

function cellText(html) {
  return decodeHtml(html.replace(/<br\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function parsePrice(text) {
  const value = Number(text.replace(/[^\d]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseCbuPage(html) {
  const text = cellText(html);
  const update = text.match(/Update date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),?\s*(\d{2}:\d{2})/i);
  const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  if (!update || !months[update[2]]) throw new Error('Could not find the CBU update date');
  const date = `${update[3]}-${months[update[2]]}-${update[1].padStart(2, '0')}`;
  const bars = [];

  for (const [, rowHtml] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cellText(cell));
    const weight = cells[0]?.match(/^(5|10|20|50|100)\s*grams?$/i);
    if (!weight || cells.length < 4) continue;
    bars.push({
      weight: Number(weight[1]),
      selling: parsePrice(cells[1]),
      buybackIntact: parsePrice(cells[2]),
      buybackDamaged: parsePrice(cells[3]),
    });
  }

  if (bars.length !== 5 || bars.some((bar) => !bar.selling || !bar.buybackIntact || !bar.buybackDamaged)) {
    throw new Error(`Expected five complete gold bar rows; found ${bars.length}`);
  }
  return { date, publishedAt: `${date}T${update[4]}:00+05:00`, bars };
}

async function fetchGoldPrices() {
  const response = await fetchWithRetry(SOURCE_URL, {
    headers: { 'user-agent': 'GoldTracker/1.0 (daily public price archive)' },
  });
  if (!response.ok) throw new Error(`CBU gold prices returned HTTP ${response.status}`);
  return parseCbuPage(await response.text());
}

async function fetchUsdRate(date) {
  const day = new Date(`${date}T12:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const requestDay = new Date(day);
    requestDay.setUTCDate(day.getUTCDate() - offset);
    const requestedDate = requestDay.toISOString().slice(0, 10);
    const response = await fetchWithRetry(`${FX_URL}/USD/${requestedDate}/`);
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

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function githubHeaders(env) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'GoldTracker-DailyUpdater',
  };
}

async function saveHistory(env, snapshot) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const filePath = 'public/data/history.json';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: githubHeaders(env) });
  if (!response.ok) throw new Error(`GitHub history read returned HTTP ${response.status}: ${await response.text()}`);
  const currentFile = await response.json();
  const history = JSON.parse(decodeBase64Utf8(currentFile.content));
  const snapshots = new Map(history.map((row) => [row.date, row]));
  snapshots.set(snapshot.date, snapshot);
  const sortedHistory = [...snapshots.values()].sort((a, b) => b.date.localeCompare(a.date));
  const content = `${JSON.stringify(sortedHistory, null, 2)}\n`;

  const update = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: { ...githubHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `Update daily gold price history (${snapshot.date})`,
      content: encodeBase64Utf8(content),
      sha: currentFile.sha,
      branch,
    }),
  });
  if (!update.ok) throw new Error(`GitHub history write returned HTTP ${update.status}: ${await update.text()}`);
  return sortedHistory.length;
}

function validateEnv(env) {
  for (const name of ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO']) {
    if (!env[name]) throw new Error(`Missing Worker secret or variable: ${name}`);
  }
}

async function updateDailyPrices(env, save = true) {
  validateEnv(env);
  const prices = await fetchGoldPrices();
  const usd = await fetchUsdRate(prices.date);
  const snapshot = {
    date: localDate(),
    sourceDate: prices.date,
    publishedAt: prices.publishedAt,
    bars: prices.bars,
    usdRate: usd.rate,
    usdRateDate: usd.date,
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
  };
  if (!save) return snapshot;
  const count = await saveHistory(env, snapshot);
  console.log(`Saved CBU prices published ${prices.date} as collection date ${snapshot.date}; ${count} history rows`);
  return snapshot;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'gold-tracker-price-updater' });
    }
    if (url.pathname !== '/check' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }
    if (!env.MANUAL_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.MANUAL_TRIGGER_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const snapshot = await updateDailyPrices(env, false);
      return Response.json({ ok: true, cbuReachable: true, sourceDate: snapshot.sourceDate, barRows: snapshot.bars.length });
    } catch (error) {
      console.error('CBU reachability check failed:', error);
      return Response.json({ ok: false, cbuReachable: false, error: error.message }, { status: 502 });
    }
  },

  async scheduled(_controller, env) {
    const snapshot = await updateDailyPrices(env);
    console.log(`Daily update complete for ${snapshot.date}`);
  },
};
