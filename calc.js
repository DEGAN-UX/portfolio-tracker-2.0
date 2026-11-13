// Parsing of DEGIRO CSV exports and return calculations. No DOM access, so it also runs in Node for testing.
(function (root) {
  const FUND_RE = /ETF|UCITS|FUND|ISHARES|VANGUARD|AMUNDI/i;
  const TRADE_RE = /^(Buy|Sell) ([\d’',]+) .*@[\d’',.]+ \w+ \(/;
  const TRADE_FEE_RE = /Transaction and\/or third party fees|Stamp Duty|Pass-Through Fee/i;
  const CONNECTION_FEE_RE = /Exchange Connection Fee/i;
  const INCOME_KINDS = { 'Dividend': 'dividends', 'Dividend Tax': 'dividendTax', 'Capital Return': 'distributions', 'Capital Gain': 'distributions' };
  const DAY = 86400000;

  // DEGIRO exports carry no sector info, so this is curated by hand. Colours: Okabe-Ito (shares) and Paul Tol muted (funds), both colourblind-safe.
  const SECTORS = {
    shares: [
      { name: 'Technology', color: '#0072B2', isins: ['US02079K3059', 'US0378331005', 'US0420682058', 'US4592001014', 'CH0025751329', 'US30303M1027', 'US5949181045', 'US67066G1040'] },
      { name: 'Industrials', color: '#E69F00', isins: ['CH0012221716', 'DE0007236101'] },
      { name: 'Financials', color: '#009E73', isins: ['US0846707026', 'CH0102484968', 'GB00BKFB1C65'] },
      { name: 'Consumer', color: '#CC79A7', isins: ['US1912161007', 'CH0038863350', 'US88160R1014'] },
      { name: 'Materials / Commodities', color: '#D55E00', isins: ['JE00B4T3BW64'] },
      { name: 'Health care', color: '#56B4E9', isins: ['CH0012032113'] },
    ],
    funds: [
      { name: 'Europe equity', color: '#332288', isins: ['LU0908500753', 'IE00B945VV12'] },
      { name: 'Swiss equity', color: '#CC6677', isins: ['CH0237935652', 'CH0008899764'] },
      { name: 'Gold', color: '#DDCC77', isins: ['CH0104136285'] },
      { name: 'Global equity', color: '#88CCEE', isins: ['IE0003XJA0J9', 'IE00B4X9L533', 'IE00B3RBWM25'] },
      { name: 'US equity', color: '#AA4499', isins: ['LU1302703878', 'IE00B3WJKG14'] },
      { name: 'Bonds', color: '#999933', isins: ['CH0226976816'] },
    ],
  };
  const UNASSIGNED = { name: 'Unassigned', color: '#BBBBBB' };
  const sectorOf = (isin, type) => SECTORS[type === 'Fund' ? 'funds' : 'shares'].find(s => s.isins.includes(isin)) || UNASSIGNED;

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }

  const num = s => (s ? parseFloat(String(s).replace(/[’'\s,]/g, '')) : 0) || 0;
  const parseDate = s => { const [d, m, y] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

  function parseStatement(text) {
    const rows = parseCsv(text);
    if (!/^Date$/i.test(rows[0]?.[0]) || !/Description/i.test(rows[0]?.[5] || '')) {
      throw new Error('This does not look like a DEGIRO account statement CSV (expected Date,…,Description,… header).');
    }
    const out = [];
    for (const r of rows.slice(1)) {
      // DEGIRO wraps long descriptions onto a new line with empty leading fields
      if (!r[0]) { if (out.length) out[out.length - 1].description += (r[5] || ''); continue; }
      out.push({
        t: parseDate(r[0]), product: r[3] || '', isin: r[4] || '', description: r[5] || '',
        fx: num(r[6]), currency: r[7] || '', amount: num(r[8]), orderId: r[11] || '',
      });
    }
    return out;
  }

  function parsePortfolio(text) {
    const rows = parseCsv(text);
    if (!/^Product$/i.test(rows[0]?.[0]) || !/ISIN/i.test(rows[0]?.[1] || '')) {
      throw new Error('This does not look like a DEGIRO portfolio CSV (expected Product,Symbol/ISIN,… header).');
    }
    const holdings = [];
    let cashChf = 0;
    for (const r of rows.slice(1)) {
      if (!r[1]) { cashChf += num(r[6]); continue; }
      holdings.push({ name: r[0], isin: r[1], qty: num(r[2]), price: num(r[3]), currency: r[4], localValue: num(r[5]), csvValueChf: num(r[6]) });
    }
    return { holdings, cashChf };
  }

  // FX column = units of foreign currency per 1 CHF, taken from DEGIRO's own conversions
  function buildFxHistory(rows) {
    const byCur = {}, byOrder = {};
    for (const r of rows) {
      if (!r.fx || r.currency === 'CHF') continue;
      // GBX-quoted trades carry a pence-per-CHF rate (~95) even though the amount is in GBP
      const rate = r.currency === 'GBP' && r.fx > 10 ? r.fx / 100 : r.fx;
      (byCur[r.currency] ||= []).push({ t: r.t, rate });
      if (r.orderId) byOrder[r.orderId + r.currency] = rate;
    }
    return (cur, t, orderId) => {
      if (cur === 'CHF') return 1;
      if (orderId && byOrder[orderId + cur]) return byOrder[orderId + cur];
      const list = byCur[cur];
      if (!list) return null;
      let best = list[0];
      for (const x of list) if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
      return best.rate;
    };
  }

  function xirr(flows) {
    if (flows.length < 2 || !flows.some(f => f.v > 0) || !flows.some(f => f.v < 0)) return null;
    const t0 = Math.min(...flows.map(f => f.t));
    const npv = r => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, (f.t - t0) / DAY / 365.25), 0);
    let lo = -0.95, hi = 10;
    if (!(npv(lo) * npv(hi) <= 0)) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // todayRates: { EUR, GBP, USD } per 1 CHF, or null to use DEGIRO's CHF values from the portfolio CSV
  function compute(statementRows, portfolio, todayRates, today = Date.now()) {
    const rateAt = buildFxHistory(statementRows);
    const warnings = [];
    const products = {};
    const totals = { tradeFees: 0, connectionFees: 0, deposits: 0, withdrawals: 0 };
    const investEvents = [];
    const get = (isin, name) => (products[isin] ||= {
      isin, name, txQty: 0, heldQty: 0, bought: 0, sold: 0, fees: 0,
      dividends: 0, dividendTax: 0, distributions: 0, value: 0, firstBuy: null, flows: [], held: false,
    });
    const toChf = r => {
      const rate = rateAt(r.currency, r.t, r.orderId);
      if (rate == null) { warnings.push(`No exchange rate found for ${r.currency} (${r.description}); counted as 0.`); return 0; }
      return r.amount / rate;
    };

    for (const r of statementRows) {
      const trade = r.description.match(TRADE_RE);
      if (trade && r.isin) {
        const p = get(r.isin, r.product);
        const qty = num(trade[2]);
        const chf = toChf(r);
        if (trade[1] === 'Buy') {
          p.txQty += qty; p.bought += -chf;
          p.firstBuy = p.firstBuy == null ? r.t : Math.min(p.firstBuy, r.t);
        } else { p.txQty -= qty; p.sold += chf; }
        p.flows.push({ t: r.t, v: chf });
        investEvents.push({ t: r.t, v: -chf, label: `${trade[1] === 'Buy' ? 'Bought' : 'Sold'} ${qty} ${r.product}` });
      } else if (TRADE_FEE_RE.test(r.description)) {
        const chf = toChf(r);
        totals.tradeFees += -chf;
        if (r.isin) { const p = get(r.isin, r.product); p.fees += -chf; p.flows.push({ t: r.t, v: chf }); investEvents.push({ t: r.t, v: -chf }); }
      } else if (CONNECTION_FEE_RE.test(r.description)) {
        totals.connectionFees += -toChf(r);
      } else if (INCOME_KINDS[r.description] && r.isin) {
        const p = get(r.isin, r.product);
        const chf = toChf(r);
        p[INCOME_KINDS[r.description]] += chf;
        p.flows.push({ t: r.t, v: chf });
      } else if (r.description === 'Deposit') totals.deposits += toChf(r);
      else if (r.description === 'Withdrawal') totals.withdrawals += -toChf(r);
    }

    for (const h of portfolio.holdings) {
      const p = get(h.isin, h.name);
      p.name = h.name; p.held = true; p.heldQty = h.qty;
      let cur = h.currency, local = h.localValue;
      if (cur === 'GBX') { cur = 'GBP'; local /= 100; }
      p.value = todayRates && cur !== 'CHF' ? (todayRates[cur] ? local / todayRates[cur] : h.csvValueChf) : (cur === 'CHF' ? local : h.csvValueChf);
      if (todayRates && cur !== 'CHF' && !todayRates[cur]) warnings.push(`No live rate for ${cur}; used DEGIRO's CHF value for ${h.name}.`);
      if (p.txQty !== h.qty) {
        warnings.push(`${h.name}: portfolio shows ${h.qty} units but transactions only explain ${p.txQty}. Its return is unreliable — the statement probably doesn't go back far enough.`);
        p.incomplete = true;
      }
    }

    // Net invested per day = cumulative purchases + trade fees − sale proceeds
    const investedSeries = [];
    let cumulative = 0;
    for (const e of investEvents.sort((a, b) => a.t - b.t)) {
      cumulative += e.v;
      let last = investedSeries[investedSeries.length - 1];
      if (!last || last.t !== e.t) investedSeries.push(last = { t: e.t, invested: 0, delta: 0, labels: [] });
      last.invested = cumulative; last.delta += e.v;
      if (e.label) last.labels.push(e.label);
    }

    const all = [];
    const portfolioFlows = [];
    for (const p of Object.values(products)) {
      if (!p.held && p.txQty === 0 && p.bought === 0) continue; // income-only ISIN without trades
      const income = p.dividends + p.dividendTax + p.distributions;
      const priceGain = p.value + p.sold - p.bought;
      const totalReturn = priceGain + income - p.fees;
      const invested = p.bought + p.fees;
      const flows = p.held ? [...p.flows, { t: today, v: p.value }] : p.flows;
      portfolioFlows.push(...flows);
      const yearsHeld = p.firstBuy ? (today - p.firstBuy) / DAY / 365.25 : 0;
      all.push({
        isin: p.isin, name: p.name, type: FUND_RE.test(p.name) ? 'Fund' : 'Share', held: p.held, qty: p.held ? p.heldQty : 0,
        firstBuy: p.firstBuy, yearsHeld,
        bought: p.bought, sold: p.sold, fees: p.fees, value: p.value,
        dividends: p.dividends + p.dividendTax, dividendsGross: p.dividends, dividendTax: p.dividendTax, distributions: p.distributions, income,
        priceGain, totalReturn, totalReturnPct: invested ? totalReturn / invested : null,
        // annualising less than a year of data extrapolates noise into huge percentages
        annualised: yearsHeld >= 1 ? xirr(flows) : null, incomplete: !!p.incomplete,
      });
    }
    all.sort((a, b) => (a.type === 'Fund') - (b.type === 'Fund') || a.name.localeCompare(b.name));

    const sum = k => all.reduce((s, p) => s + p[k], 0);
    const invested = sum('bought') + sum('fees');
    const summary = {
      bought: sum('bought'), sold: sum('sold'), fees: sum('fees'), value: sum('value'),
      dividends: sum('dividends'), distributions: sum('distributions'), income: sum('income'),
      priceGain: sum('priceGain'), totalReturn: sum('totalReturn'),
      totalReturnPct: invested ? sum('totalReturn') / invested : null,
      annualised: xirr(portfolioFlows),
      cashChf: portfolio.cashChf, ...totals,
    };
    return { date: new Date(today).toISOString(), todayRates, products: all, summary, investedSeries, warnings };
  }

  const api = { parseCsv, parseStatement, parsePortfolio, compute, xirr, SECTORS, UNASSIGNED, sectorOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
