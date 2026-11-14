# Project Notes: Quick Finance Calculator

## Purpose
Shows total and annualised return (in CHF) per share/fund from DEGIRO CSV exports, and saves snapshots for later comparison. Must run without a server so it can move to Android later.

## How It Works
- `index.html`: UI. Compact CSV picker/drop target in the header; file type auto-detected from header row; calculates automatically once both CSVs are loaded. Drops anywhere on the page are caught. Opens directly via `file://`.
- Sticky responsive header has Home, Exchange rate dropdown (Current rates modal), and Snapshots button (history/backup modal). Current-rates dialog shows retrieval timestamp, ECB rate date, and EUR/GBP/USD values. Snapshot backup/export/import controls are always visible in the modal, without a disclosure toggle.
- The four result metric cards are native collapsed `<details>` panels; click/keyboard activation reveals supporting figures while headline values stay visible. Total return expansion contains price/income breakdown, trade fees, and yearly exchange connection fees (explicitly excluded from returns); no separate Breakdown/Spent on trading cards.
- Import/restore notifications use a dismissible 10-second toast instead of a persistent filename list. Parse, file-read, IndexedDB-save/restore, and calculation failures show warning/error toasts.
- Last-used CSV texts persist in IndexedDB (`portfolioApp` db, `files` store, keys `statement`/`portfolio`); restored + recalculated (fresh FX) on page load and once per local day while in use (midnight timer + foreground check); retries when connectivity returns if live rates were unavailable. Toast reports ECB data date or CSV CHF fallback. Snapshots stay in localStorage (`portfolioSnapshots`); one is auto-saved per day on file import (same-day import replaces it), not on page-refresh restore. Snapshots nav opens history and backup/export controls in a dialog; viewing one shows "Back to today's figures".
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
- Table view toggle (persisted in localStorage `groupMode`): light segmented control for Alphabetical (Shares then Funds, each A–Z), By sector (subtotal rows per sector; % of shares/funds), or Best performing (held products first, then descending annualised return within separate Shares/Funds groups; sold products and unavailable annualised values last). A Show legend button opens a draggable, non-modal popup with the two sector lists and an X close control; page actions outside the popup remain available. 5px sector colour bar on the Product cell. Product cell background bar ∝ value today; Annualised cell bar ∝ best annualised.

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
- Hosting: GitHub Pages, https://degan-ux.github.io/portfolio-tracker-2.0/ (repo DEGAN-UX/portfolio-tracker-2.0, public; only app files pushed — `samples/` is gitignored).
- Installable PWA: `manifest.webmanifest`, `sw.js` (network-first, cache fallback for offline; bump `CACHE` name if file list changes), icons `icon.svg` → `icon-192.png`/`icon-512.png` (rendered with puppeteer-core). SW only registers over http(s), not `file://`. VS Code's integrated browser doesn't run service workers — test PWA in real Chrome.
- App: none. Internet only for today's FX (`https://api.frankfurter.dev/v1/latest?base=CHF`, CORS `*`; old api.frankfurter.app redirects).
- PoC: Node 18+, Google Chrome, `puppeteer-core`.

## Roadmap
- Planned: Android (wrap as PWA / installable page).
- Not planned: PDF import.

## Testing
- Node sanity check against `samples/` (see calc.js API: parseStatement, parsePortfolio, compute).
- Reconciliation: tx-derived units must equal portfolio units (app warns otherwise).
- Manual: open `index.html`, import both sample CSVs.
