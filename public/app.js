const $ = (selector) => document.querySelector(selector);
const number = new Intl.NumberFormat('en-US');
const dollars = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent' });
let priceHistory = [];

function formatDate(value) {
  return dateFormat.format(new Date(`${value}T12:00:00+05:00`));
}

function pricePerGram(snapshot) {
  const bar = snapshot.bars.find((entry) => entry.weight === 100);
  return bar ? Math.round(bar.selling / 100) : null;
}

function moneyPair(uzs, rate, primary = false) {
  return `<span class="money-pair"><span class="money-uzs${primary ? ' primary' : ''}">${number.format(uzs)} <small>UZS</small></span><span class="money-usd">$${dollars.format(uzs / rate)} USD</span></span>`;
}

function renderCurrent(snapshot) {
  if (!snapshot) return;
  const published = new Date(snapshot.publishedAt);
  const perGram = pricePerGram(snapshot);
  $('#price-per-gram').innerHTML = `<span>${number.format(perGram)}<small>UZS</small></span><span class="price-usd">$${dollars.format(perGram / snapshot.usdRate)} <small>USD</small></span>`;
  $('#usd-rate').textContent = `CBU rate: 1 USD = ${number.format(snapshot.usdRate)} UZS · ${formatDate(snapshot.usdRateDate)}`;
  $('#published-date').textContent = formatDate(snapshot.sourceDate || snapshot.date);
  $('#published-time').textContent = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent', timeZoneName: 'short',
  }).format(published);
  $('#price-rows').innerHTML = snapshot.bars.map((bar) => `
    <tr>
      <td>${bar.weight} grams</td>
      <td class="price-cell">${moneyPair(bar.selling, snapshot.usdRate, true)}</td>
      <td class="price-cell">${moneyPair(bar.buybackIntact, snapshot.usdRate)}</td>
      <td class="price-cell">${moneyPair(bar.buybackDamaged, snapshot.usdRate)}</td>
    </tr>`).join('');
}

function renderHistory(history) {
  const host = $('#history-rows');
  if (!history.length) return;
  const selectedWeight = Number($('#history-weight').value || 100);
  host.innerHTML = history.map((snapshot, index) => {
    const selling = snapshot.bars.find((bar) => bar.weight === selectedWeight)?.selling;
    const currentGram = pricePerGram(snapshot);
    const previousGram = history[index + 1] ? pricePerGram(history[index + 1]) : null;
    const delta = previousGram !== null ? currentGram - previousGram : null;
    const direction = delta === null || delta === 0 ? '—' : `${delta > 0 ? '+' : '−'}${number.format(Math.abs(delta))}`;
    const cls = delta > 0 ? '' : delta < 0 ? 'down' : '';
    const variance = previousGram === null || previousGram === 0 ? null : (delta / previousGram) * 100;
    const varianceText = variance === null ? '—' : (variance > 0 ? '+' : '') + variance.toFixed(2) + '%';
    return `<div class="history-row">
      <span class="history-date" title="CBU publication date: ${formatDate(snapshot.sourceDate || snapshot.date)}">${formatDate(snapshot.date)}<small>CBU ${formatDate(snapshot.sourceDate || snapshot.date)}</small></span>
      <span class="mono">${moneyPair(pricePerGram(snapshot), snapshot.usdRate)}</span>
      <span class="mono">${moneyPair(selling, snapshot.usdRate)}</span>
      <span class="change ${cls}">${direction} UZS</span>
      <span class="change ${cls}">${varianceText}</span>
    </div>`;
  }).join('');
}

function updateMonthOptions(history) {
  const months = [...new Set(history.map((entry) => entry.date.slice(0, 7)))].sort().reverse();
  $('#month-select').innerHTML = '<option value="">Select month</option>' + months.map((month) => {
    const date = new Date(month + '-01T12:00:00+05:00');
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(date);
    return '<option value="' + month + '">' + label + '</option>';
  }).join('');
  $('#month-select').disabled = months.length === 0;
}

function renderChart(entries, periodLabel) {
  const canvas = $('#chart-canvas');
  $('#chart-period').textContent = periodLabel;
  if (!entries.length) {
    canvas.innerHTML = '<div class="chart-empty">No saved prices for this period yet.</div>';
    return;
  }
  const points = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ date: entry.date, value: pricePerGram(entry) })).filter((point) => Number.isFinite(point.value));
  if (!points.length) {
    canvas.innerHTML = '<div class="chart-empty">No saved prices for this period yet.</div>';
    return;
  }
  const width = 760;
  const height = 300;
  const pad = { top: 22, right: 20, bottom: 43, left: 76 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const rawMin = Math.min(...points.map((point) => point.value));
  const rawMax = Math.max(...points.map((point) => point.value));
  const spread = rawMax - rawMin;
  const step = spread === 0 ? Math.max(rawMax * 0.02, 1) : spread * 0.18;
  const min = rawMin - step;
  const max = rawMax + step;
  const x = (index) => points.length === 1 ? pad.left + plotWidth / 2 : pad.left + (index / (points.length - 1)) * plotWidth;
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotHeight;
  const grid = Array.from({ length: 4 }, (_, index) => {
    const value = max - ((max - min) * index) / 3;
    const position = pad.top + (plotHeight * index) / 3;
    return '<line class="chart-grid" x1="' + pad.left + '" y1="' + position + '" x2="' + (width - pad.right) + '" y2="' + position + '"/><text class="chart-axis" x="' + (pad.left - 10) + '" y="' + (position + 3) + '" text-anchor="end">' + number.format(Math.round(value)) + '</text>';
  }).join('');
  const line = points.map((point, index) => (index === 0 ? 'M' : 'L') + ' ' + x(index) + ' ' + y(point.value)).join(' ');
  const area = line + ' L ' + x(points.length - 1) + ' ' + (height - pad.bottom) + ' L ' + x(0) + ' ' + (height - pad.bottom) + ' Z';
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const tickDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Tashkent' });
  const labels = labelIndexes.map((index) => '<text class="chart-axis" x="' + x(index) + '" y="' + (height - 15) + '" text-anchor="' + (index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle') + '">' + tickDate.format(new Date(points[index].date + 'T12:00:00+05:00')) + '</text>').join('');
  const circles = points.map((point, index) => '<circle class="chart-point" cx="' + x(index) + '" cy="' + y(point.value) + '" r="3.5"><title>' + formatDate(point.date) + ' · ' + number.format(point.value) + ' UZS/g</title></circle>').join('');
  canvas.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Daily gold selling price per gram in Uzbek som">' +
    '<defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#bd9758" stop-opacity=".2"/><stop offset="100%" stop-color="#bd9758" stop-opacity="0"/></linearGradient></defs>' +
    grid + '<path class="chart-area" d="' + area + '"/><path class="chart-line" d="' + line + '"/>' + circles + labels + '</svg>';
}

function showRange(days) {
  $('#month-select').value = '';
  const newest = priceHistory[0]?.date;
  if (!newest) return renderChart([], 'LAST ' + days + ' DAYS');
  const cutoff = new Date(newest + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  renderChart(priceHistory.filter((entry) => entry.date >= cutoffDate && entry.date <= newest), 'LAST ' + days + ' DAYS');
}

async function load() {
  try {
    const historyResponse = await fetch('data/history.json');
    if (!historyResponse.ok) throw new Error('Unable to load price data');
    const history = await historyResponse.json();
    const current = history[0] || null;
    priceHistory = history;
    renderCurrent(current);
    renderHistory(history);
    updateMonthOptions(history);
  } catch (error) {
    $('#published-date').textContent = 'Price data unavailable';
    $('#price-rows').innerHTML = '<tr><td colspan="4" class="loading-cell">Could not load prices. Please try again shortly.</td></tr>';
  }
}

const chartDialog = $('#chart-dialog');
$('#history-weight').addEventListener('change', () => renderHistory(priceHistory));
$('#open-chart').addEventListener('click', () => {
  chartDialog.showModal();
  showRange(7);
});
$('#close-chart').addEventListener('click', () => chartDialog.close());
chartDialog.addEventListener('click', (event) => {
  if (event.target === chartDialog) chartDialog.close();
});
document.querySelectorAll('.range-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.range-button').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    showRange(Number(button.dataset.range));
  });
});
$('#month-select').addEventListener('change', (event) => {
  const month = event.target.value;
  if (!month) return;
  document.querySelectorAll('.range-button').forEach((item) => item.classList.remove('is-active'));
  const entries = priceHistory.filter((entry) => entry.date.startsWith(month));
  const date = new Date(month + '-01T12:00:00+05:00');
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(date).toUpperCase();
  renderChart(entries, label);
});

load();
