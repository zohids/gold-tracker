import { refreshPrices } from '../server.js';

try {
  const result = await refreshPrices();
  console.log(`Saved CBU gold bar prices for ${result.date}`);
  process.exit(0);
} catch (error) {
  console.error('Could not update CBU gold prices:', error);
  process.exit(1);
}
