import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

const API_BASE = process.env.REACT_APP_YIELD_CURVE_APP_API_BASE || 'http://localhost:4000/api';

const ANIMATION_DELAY = 100;

function App() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [showDateError, setShowDateError] = useState(false);
  const [earliestDate, setEarliestDate] = useState('');
  const [curve, setCurve] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [animating, setAnimating] = useState(false);

  // Animate through all dates
  async function animateCurve() {
    if (dates.length === 0) return;
    // Sort dates ascending for animation
    const sortedDates = [...dates].sort();
    setAnimating(true);
    for (let i = 0; i < sortedDates.length; i++) {
      setSelectedDate(sortedDates[i]);
      await new Promise(res => setTimeout(res, ANIMATION_DELAY));
    }
    setAnimating(false);
  }

  useEffect(() => {
    async function fetchDates() {
      try {
        const res = await fetch(`${API_BASE}/dates`);
        const data = await res.json();
        if (!data.dates || data.dates.length === 0) throw new Error('No dates');
        const sorted = [...data.dates].sort();
        // Convert all dates to yyyy-MM-dd for <input type="date">
        const toISO = d => {
          // Accepts d as 'MM/DD/YYYY' or 'YYYY-MM-DD', returns 'YYYY-MM-DD'
          if (/\d{4}-\d{2}-\d{2}/.test(d)) return d;
          const [mm, dd, yyyy] = d.split('/');
          return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
        };
        const isoDates = sorted.map(toISO);
        setDates(isoDates);
        setEarliestDate(isoDates[0]);
      } catch (err) {
        setError('Failed to fetch dates');
      }
    }
    fetchDates();
  }, []);

  // Always keep selectedDate in sync with dates (most recent)
  useEffect(() => {
    if (dates.length > 0) {
      // If selectedDate is not in dates, set to most recent
      if (!dates.includes(selectedDate)) {
        setSelectedDate(dates[dates.length - 1]);
      }
    }
  }, [dates]);

  // Fetch curve for selected date
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    setError('');
    // Convert selectedDate from 'yyyy-MM-dd' to 'MM/DD/YYYY' for backend
    const toBackendDate = d => {
      if (!d) return '';
      const [yyyy, mm, dd] = d.split('-');
      return `${mm}/${dd}/${yyyy}`;
    };
    fetch(`${API_BASE}/yield-curve?date=${encodeURIComponent(toBackendDate(selectedDate))}`)
      .then(async res => {
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || 'Failed to fetch yield curve');
        }
        return res.json();
      })
      .then(data => {
        setCurve(data.curve || []);
        setLoading(false);
      })
      .catch(err => {
        setError('Error loading yield curve: ' + err.message);
        setCurve([]);
        setLoading(false);
      });
  }, [selectedDate, dates]);

  // Helper to convert maturity label to months and to date
  function maturityToMonths(label) {
    const mo = label.match(/([\d.]+)\s*Mo/i);
    if (mo) return parseFloat(mo[1]);
    const yr = label.match(/([\d.]+)\s*YR/i);
    if (yr) return parseFloat(yr[1]) * 12;
    return null;
  }
  function maturityToDate(label) {
    const base = new Date(2000, 0, 1);
    const months = maturityToMonths(label.replace(/Month/i,'Mo'));
    if (months == null) return null;
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  // Filter out the first few maturities
  // Remove first few maturities (1 Mo, 1.5 Mo, 2 Mo, 3 Mo, 4 Mo)
  // Remove first few maturities (1 Mo, 1.5 Mo, 1.5 Month, 2 Mo, 3 Mo, 4 Mo)
  // Remove first few maturities (1 Mo, 1.5 Mo, 1.5 Month, 2 Mo, 3 Mo, 4 Mo, 1 Yr)
  const filteredCurve = curve.filter(pt =>
    !/^([1]|2|3|4)\s*mo$/i.test(pt.maturity.trim()) &&
    !/^1\.5\s*(mo|month)$/i.test(pt.maturity.trim()) &&
    !/^1\s*yr$/i.test(pt.maturity.trim())
  );
  console.log("filtered curve");
  console.log(filteredCurve);

  const chartData = {
    datasets: [
      {
        label: `Yield Curve (${selectedDate})`,
        data: filteredCurve.map(pt => ({ x: maturityToDate(pt.maturity), y: pt.rate, maturity: pt.maturity })),
        fill: false,
        borderColor: 'rgb(75, 192, 192)',
        cubicInterpolationMode: 'monotone',
      }
    ]
  };

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>US Treasury Yield Curve Viewer</h2>
      {error && (
        <div style={{ color: 'red', marginBottom: 16 }}>
          <b>Error:</b> {error}
        </div>
      )}
      {dates.length === 0 ? (
        <div>No dates available.</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label>
            Select Date:{' '}
            <input
              type="date"
              value={selectedDate}
              onChange={e => {
                const val = e.target.value;
                if (!dates.includes(val)) {
                  setShowDateError(true);
                  // Don't update selectedDate
                } else {
                  setShowDateError(false);
                  setSelectedDate(val);
                }
              }}
              style={{ fontSize: '1rem', margin: '0 10px' }}
              disabled={animating}
              min={earliestDate}
              max={dates[dates.length-1]}
            />
          </label>
          <button
            onClick={animateCurve}
            disabled={animating || dates.length === 0}
            style={{ fontSize: '1rem', padding: '4px 16px', cursor: animating ? 'not-allowed' : 'pointer' }}
          >
            {animating ? 'Animating...' : 'Animate Curve'}
          </button>
        </div>
      )}
      {showDateError && (
        <div style={{ color: 'red', marginBottom: 8 }}>
          The earliest date is {earliestDate}
        </div>
      )}
      {loading && !animating ? (
        <div>Loading chart...</div>
      ) : (
        <Line data={chartData} options={{
          responsive: true,
          animation: animating ? false : undefined,
          plugins: {
            legend: { display: false },
            title: { display: false },
            tooltip: {
              callbacks: { title: items => items[0].raw.maturity, label: item => `Rate: ${item.raw.y}` }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: { unit: 'month', displayFormats: { month: 'MMM yyyy' } },
              title: { display: true, text: 'Maturity', font: { size: 14 } },
              ticks: {
                source: 'data',
                autoSkip: false,
                callback: function(val) {
                  const match = chartData.datasets[0].data.find(d => d.x.getTime() === new Date(val).getTime());
                  return match ? match.maturity : '';
                },
                minRotation: 45,
                maxRotation: 45
              },
              grid: {
                display: true,
                drawTicks: true,  
                borderColor: "transparent", //horizontal line color above ticks (x-axis)
                color: "transparent",   //grid lines color
                tickColor: "#868e96"  //ticks color (little line above points)
              },
              min: new Date(2000, 0, 1),
              max: maturityToDate(filteredCurve[filteredCurve.length-1]?.maturity || '' )
            },
            y: {
              beginAtZero: true,
              min: 0,
              max: 8.0,
              title: { display: true, text: 'Treasury Par Rate', font: { size: 14 } },
              grid: {
                display: true,
                drawTicks: true,  
                borderColor: "transparent", //horizontal line color above ticks (x-axis)
                color: "transparent",   //grid lines color
                tickColor: "#868e96"  //ticks color (little line above points)
              },
            }
          }
        }} />
      )}
    </div>
  );
}

export default App;
