import { refreshPrices, getPriceHistory, checkpointDatabase } from '../server.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve('public/data');

try {
  const result = await refreshPrices();
  checkpointDatabase();
  await mkdir(dataDirectory, { recursive: true });
  const historyPath = path.join(dataDirectory, 'history.json');
  let savedHistory = [];
  try {
    savedHistory = JSON.parse(await readFile(historyPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // GitHub Actions starts from a fresh checkout on each run. Keep the
  // committed JSON archive as the durable history and merge in database rows,
  // allowing newer copies of the same day to replace older snapshots.
  const snapshots = new Map(savedHistory.map((snapshot) => [snapshot.date, snapshot]));
  for (const snapshot of getPriceHistory()) {
    const previous = snapshots.get(snapshot.date);
    if (!previous || snapshot.fetchedAt > (previous.fetchedAt || '')) {
      snapshots.set(snapshot.date, snapshot);
    }
  }
  const history = [...snapshots.values()].sort((a, b) => b.date.localeCompare(a.date));
  await writeFile(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`Saved CBU gold bar prices for ${result.date}`);
  process.exit(0);
} catch (error) {
  console.error('Could not update CBU gold prices:', error);
  process.exit(1);
}
