import { refreshPrices, getPriceHistory } from '../server.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve('public/data');

try {
  const result = await refreshPrices();
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(path.join(dataDirectory, 'history.json'), JSON.stringify(getPriceHistory(), null, 2) + '\n');
  console.log(`Saved CBU gold bar prices for ${result.date}`);
  process.exit(0);
} catch (error) {
  console.error('Could not update CBU gold prices:', error);
  process.exit(1);
}
