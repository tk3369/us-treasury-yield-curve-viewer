// scheduler.js
import { fetchAndParseCSV } from './index.js';

function logWithTimestamp(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}
function errorWithTimestamp(...args) {
  const ts = new Date().toISOString();
  console.error(`[${ts}]`, ...args);
}

export function scheduleCsvRefresh() {
  setInterval(async () => {
    try {
      logWithTimestamp('Scheduled: Refreshing Treasury CSV data...');
      await fetchAndParseCSV(true); // pass a flag to force refresh
      logWithTimestamp('Treasury CSV data refreshed.');
    } catch (err) {
      errorWithTimestamp('Error refreshing Treasury CSV data:', err);
    }
  }, 60 * 60 * 1000); // every hour
}

