import express from 'express';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import cors from 'cors';

const PORT = 4000;
// Helper to generate all months from Jan 2025 to now (inclusive)
function getAllMonths() {
  const start = new Date(2025, 0, 1); // Jan 2025
  const now = new Date();
  const months = [];
  let y = start.getFullYear(), m = start.getMonth();
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
    const ym = `${y}${(m+1).toString().padStart(2,'0')}`;
    months.push(ym);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return months;
}

function makeCsvUrl(yyyymm) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${yyyymm}?field_tdr_date_value_month=${yyyymm}&type=daily_treasury_yield_curve&page&_format=csv`;
}


const app = express();
app.use(cors());

let cachedData = null;
let cachedDates = null;

async function fetchAndParseCSV() {
  const months = getAllMonths();
  console.log('Fetching CSVs for months:', months.join(', '));
  const fetches = months.map(ym =>
    fetch(makeCsvUrl(ym))
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch CSV for ${ym}`);
        return res.text();
      })
      .then(csvText => {
        const records = parse(csvText, { columns: true, skip_empty_lines: true });
        return records;
      })
      .catch(e => {
        console.error('Fetch error for', ym, e);
        return [];
      })
  );
  const allRecordsArr = await Promise.all(fetches);
  // Flatten to a single array
  const allRecords = allRecordsArr.flat();
  if (!allRecords || allRecords.length === 0) {
    throw new Error('Parsed CSVs are empty.');
  }
  console.log('All CSVs parsed. Total records:', allRecords.length);
  return allRecords;
}

// Helper to extract available dates
function extractDates(records) {
  return Array.from(new Set(records.map(r => r['Date'])));
}

// Helper to extract maturity columns (e.g., '5 YR', '30 YR')
function extractMaturities(records) {
  const sample = records[0];
  // Match columns like '1 Mo', '3 Mo', '6 Mo', '1 YR', '2 YR', etc.
  return Object.keys(sample).filter(key => /\d+\s*(Mo|YR)/i.test(key));
}

// Debug endpoint to see a sample of the raw CSV
app.get('/api/debug-csv', async (req, res) => {
  try {
    const response = await fetch(CSV_URL);
    const text = await response.text();
    res.type('text/plain').send(text.slice(0, 1000)); // send first 1000 chars
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get available dates
app.get('/api/dates', async (req, res) => {
  try {
    if (!cachedData) cachedData = await fetchAndParseCSV();
    if (!cachedDates) cachedDates = extractDates(cachedData);
    if (!cachedDates || cachedDates.length === 0) {
      throw new Error('No dates found in CSV.');
    }
    res.json({ dates: cachedDates });
  } catch (err) {
    console.error('Error in /api/dates:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get yield curve for a date
app.get('/api/yield-curve', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Missing date param' });
  try {
    if (!cachedData) cachedData = await fetchAndParseCSV();
    const record = cachedData.find(r => r['Date'] === date);
    if (!record) {
      console.error('No record for date', date, 'in CSV.');
      return res.status(404).json({ error: 'Date not found' });
    }
    const maturities = extractMaturities([record]);
    if (!maturities || maturities.length === 0) {
      throw new Error('No maturity columns found for this date.');
    }
    const curve = maturities.map(maturity => ({
      maturity,
      rate: record[maturity] !== '' ? parseFloat(record[maturity]) : null
    }));
    res.json({ date, curve });
  } catch (err) {
    console.error('Error in /api/yield-curve:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch and cache data, then start server only when ready
(async () => {
  try {
    console.log('Starting initial Treasury data download...');
    cachedData = await fetchAndParseCSV();
    cachedDates = extractDates(cachedData);
    console.log('Initial Treasury data download complete. Starting backend server...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Initial Treasury data download failed:', err);
    process.exit(1);
  }
})();
