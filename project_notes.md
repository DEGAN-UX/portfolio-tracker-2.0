# Project Notes: Quick Finance Calculator

## Purpose
Shows total and annualised return (in CHF) per share/fund from DEGIRO CSV exports, and saves snapshots for later comparison. Must run without a server so it can move to Android later.

## How It Works
- `index.html`: UI. Single drop zone (or multi-file picker) for both CSVs; file type auto-detected from header row; calculates automatically once both are loaded → cards + per-product table → Save snapshot (localStorage `portfolioSnapshots`, export/import as JSON). Drops anywhere on the page are caught. Opens directly via `file://`.
- Last-used CSV texts persist in IndexedDB (`portfolioApp` db, `files` store, keys `statement`/`portfolio`); restored + recalculated (fresh FX) on page load. Snapshots stay in localStorage (`portfolioSnapshots`); one is auto-saved per day on file import (same-day import replaces it), not on page-refresh restore. "History" section lists them as date buttons; viewing one shows "Back to today's figures". Export/import JSON is tucked in a `<details>` Backup section.
- `calc.js`: pure parsing + maths (no DOM), runs in browser and Node (`require('./calc.js')`).
  - Buy/Sell/fees/income converted to CHF with the FX rate DEGIRO used (FX row with same Order Id, else nearest-dated FX row for that currency).
  - Today's value: portfolio local value ÷ today's Frankfurter rate (fallback: CSV's "Value in CHF" if offline).
  - Total return = value + sales − purchases + dividends (net of tax) + distributions (Capital Return/Gain) − trade fees. % is of purchases + fees.
  - Annualised = XIRR of product cash flows; hidden for holdings < 1 year old.
  - Trade-fee tally: transaction fees, stamp duty, ADR fees. Exchange connection fees tallied separately, not in product returns.
  - Share vs Fund: name regex (ETF|UCITS|FUND|ISHARES|VANGUARD|AMUNDI).
  - `investedSeries`: per-day cumulative net invested (purchases + trade fees − sale proceeds) with trade labels; feeds the chart.
- Chart (bottom of results): hand-rolled SVG, no library. Blue step-area = net invested; orange line = portfolio value from snapshots only (DEGIRO CSVs have no historical prices — no free CORS price API for these ISINs). Tooltips on hover/drag/arrow keys. Okabe-Ito blue/orange.
  - Sectors: hand-curated ISIN map `SECTORS` in `calc.js` (shares: Technology, Industrials, Financials, Consumer, Materials/Commodities, + Health care for sold Roche; funds: Europe/Swiss/Global/US equity, Gold, Bonds). New ISINs show as "Unassigned" until added to the map. Colours: Okabe-Ito (shares) / Paul Tol muted (funds), colourblind-safe; always paired with text labels.
- Table view toggle (persisted in localStorage `groupMode`): Alphabetical (Shares then Funds, each A–Z) or By sector (subtotal rows per sector; % of shares/funds). 5px sector colour bar on the Product cell, legend above the table. Product cell background bar ∝ value today; Annualised cell bar ∝ best annualised.

### Proof of concept (superseded)
- `server.js`: Node HTTP server on port 3000.
- Each page load starts headless Chrome (`puppeteer-core`, using the installed Google Chrome), searches `one chf equals <CUR>` and reads `span[data-value]` from Google's currency widget.

## Key Decisions
- Headless browser instead of plain `fetch`: Google returns an "unsupported browser" page without JS. (Nov 2026)
- `puppeteer-core` + system Chrome: no Chromium download. (Nov 2026)
- Real app (portfolio ROI): no server, static HTML/JS so it can move to Android later. FX from Frankfurter (ECB rates, CORS-enabled) instead of Google scraping, approved by user. (Nov 2026)
- Input data: DEGIRO CSV exports only, no PDFs (user decision). Samples in `samples/`. Dates DD-MM-YYYY, GBX = GBP pence. (Nov 2026)
- Dividends and fund distributions count towards return, shown separately so it's clear (user decision). (Nov 2026)

## Known Gotchas
- Google redirects to `/sorry/` (captcha) if it detects automation. Fix: drop `--enable-automation`, add `--disable-blink-features=AutomationControlled`, strip `HeadlessChrome` from the UA, persistent profile in `.chrome-profile/`.
- Too many requests in a short time also trigger the captcha.
- `span[data-value]` is an undocumented Google class/attribute; may break at any time.
- DEGIRO statement CSV: some long descriptions wrap onto a new physical line with empty leading fields (e.g. "Bank: 10’" / "003.33 CHF"). Must be merged with the previous row.
- Buy/Sell quantity and price only exist inside the Description text: `Buy 20 Name@176.16 CHF (ISIN)`. Fees are separate rows sharing the Order Id.
- FX column = foreign units per 1 CHF, but for GBX-quoted trades it's pence per CHF (~95) while the amount is in GBP. `calc.js` divides GBP rates > 10 by 100.
- Foreign buys' computed CHF cost matches DEGIRO's CHF FX Debit within 0.79 CHF across 54 orders.
- `samples/transactions.csv` now starts 30-06-2022 (account opening); all 27 holdings reconcile. An earlier export started 03-01-2023 and missed 8 SMI ETF shares — DEGIRO's default export range may not cover full history.

## Dependencies
- App: none. Internet only for today's FX (`https://api.frankfurter.dev/v1/latest?base=CHF`, CORS `*`; old api.frankfurter.app redirects).
- PoC: Node 18+, Google Chrome, `puppeteer-core`.

## Roadmap
- Planned: Android (wrap as PWA / installable page).
- Not planned: PDF import.

## Testing
- Node sanity check against `samples/` (see calc.js API: parseStatement, parsePortfolio, compute).
- Reconciliation: tx-derived units must equal portfolio units (app warns otherwise).
- Manual: open `index.html`, import both sample CSVs.
