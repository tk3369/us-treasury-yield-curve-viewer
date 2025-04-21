import express from 'express';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const PORT = 4000;
// Helper to generate all months from Jan 2025 to now (inclusive)
function getAllMonths() {
  const start = new Date(2025, 0, 1); // Jan 2025
  const now = new Date();
  const months = [];
  let y = start.getFullYear(), m = start.getMonth();
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
    const ym = `${y}${(m + 1).toString().padStart(2, '0')}`;
    months.push(ym);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return months;
}

function makeCsvUrl(yyyymm) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${yyyymm}?field_tdr_date_value_month=${yyyymm}&type=daily_treasury_yield_curve&page&_format=csv`;
}


function logWithTimestamp(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

const app = express();
app.use(helmet());
// Log every request
app.use((req, res, next) => {
  logWithTimestamp(`Request: ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});
let lastRateLimitLog = 0;
const host = process.env.REACT_APP_YIELD_CURVE_APP_API_BASE ? "ahsmart.com" : "localhost";
const corsLocation = `http://${host}:3000`;
const limiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 100, // QPS per IP address
  handler: function (req, res, next) {
    const now = Date.now();
    if (now - lastRateLimitLog > 60 * 1000) {
      lastRateLimitLog = now;
      logWithTimestamp(`Rate limit exceeded for IP: ${req.ip}`);
    }
    res.status(429).json({ message: "Too many requests, please try again later." });
  }
});
app.use(limiter);
app.use(cors({
  origin: corsLocation
}));

// Enable browser caching for API responses (5 minutes)
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
  }
  next();
});

let cachedData = null;
let cachedDates = null;

export async function fetchAndParseCSV(force = false) {
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

// Endpoint to get all yield curve data
app.get('/api/yield-curves', async (req, res) => {
  try {
    if (!cachedData) cachedData = await fetchAndParseCSV();
    if (!cachedDates) cachedDates = extractDates(cachedData);
    if (!cachedData || cachedData.length === 0) {
      throw new Error('No yield curve data available');
    }
    res.json({ 
      data: cachedData,
      dates: cachedDates 
    });
  } catch (err) {
    console.error('Error in /api/yield-curves:', err);
    res.status(500).json({ error: err.message });
  }
});

import { scheduleCsvRefresh } from './scheduler.js';

(async () => {
  try {
    cachedData = await fetchAndParseCSV(true); // always fetch fresh data on startup
    cachedDates = extractDates(cachedData);
    console.log('Initial Treasury data download complete. Starting backend server...');
    // Start the scheduler
    scheduleCsvRefresh();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize Treasury data:', err);
    process.exit(1);
  }
})();
