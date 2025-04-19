# Yield Curve Viewer

This web app fetches US Treasury yield curve data from the official Treasury website and displays it in an interactive chart. Select a date to view the yield curve for that day.

## Structure
- `/backend`: Express server to fetch and parse CSV data
- `/frontend`: React app to display the chart

## Usage
1. Start the backend server
2. Start the frontend app

---

CSV Source: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/202504?field_tdr_date_value_month=202504&type=daily_treasury_real_yield_curve&page&_format=csv
