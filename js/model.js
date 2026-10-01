/* =====================================================================
 * model.js — Financial Modeling Playground calculation engine
 * Pure, deterministic JavaScript. No APIs, no randomness, no AI math.
 * Every figure is reproducible from visible formulas + user inputs.
 * ===================================================================== */

const UNITS = { K: 1e3, M: 1e6, B: 1e9 };

/* ---------- default model (sample company: Atlas Components Inc.) ---- */
function createDefaultModel() {
  return {
    meta: {
      name: 'Atlas Components Inc.',
      ticker: 'ATLS',
      currency: '$',
      unit: 'M',            // display units for all $ figures (M = millions)
      baseYear: 2024,       // last historical year
      forecastYears: 5,     // fixed at 5 by design
      sharesOut: 48.0,      // diluted shares outstanding (millions)
      netDebtStart: 60.0,   // net debt at start of first forecast year ($M)
      bookEquityStart: 175.0, // opening shareholders' equity for derived BS ($M)
      currentPrice: 21.0,   // market price per share (for upside / reverse DCF)
    },
    /* Historical actuals (in model units). Used for KPIs, trend charts and
       red-flag checks. Derived balance sheet is internally consistent. */
    history: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue:   [280.0, 330.0, 392.0, 448.0, 500.0],
      cogs:      [189.0, 217.8, 247.0, 273.3, 295.0],
      ebitda:    [ 33.6,  46.2,  62.7,  76.2,  95.0],
      da:        [ 14.0,  16.5,  19.6,  22.4,  25.0],
      interest:  [  5.0,   5.4,   5.8,   6.1,   6.4],
      taxRate:   [ 0.25,  0.25,  0.25,  0.25,  0.25],
      capex:     [ 20.0,  24.0,  28.0,  30.0,  33.0],
      fcf:       [  6.0,  11.0,  16.5,  22.0,  31.0],
      netDebt:   [ 48.0,  52.0,  55.0,  58.0,  60.0],
      cash:      [ 18.0,  22.0,  26.0,  31.0,  38.0],
      totalDebt: [ 66.0,  74.0,  81.0,  89.0,  98.0],
    },
    /* Scenario assumptions — each scenario independently editable.
       Percentages are stored as decimals (0.10 = 10%). */
    scenarios: {
      base: { label: 'Base', assumptions: {
        revGrowth: [0.12, 0.12, 0.11, 0.10, 0.10],
        grossMargin: 0.41,
        ebitdaMargin: 0.19,
        daPctRevenue: 0.05,
        taxRate: 0.25,
        capexPctRevenue: 0.065,
        nwcPctRevenue: 0.12,      // reference only; NWC driven by day counts
        recDays: 55, invDays: 60, payDays: 40,
        newDebt: [0, 0, 0, 0, 0], // incremental debt raised per year ($M)
        debtRepay: 5,             // mandatory amortization per year ($M)
        interestRate: 0.06,
        wacc: 0.10,
        terminalGrowth: 0.025,
        exitPe: 16,               // P/E multiple applied to final-year PAT
        exitEvEbitda: 11,         // EV/EBITDA multiple on final-year EBITDA
      }},
      bull: { label: 'Bull', assumptions: {
        revGrowth: [0.14, 0.13, 0.12, 0.11, 0.10],
        grossMargin: 0.43,
        ebitdaMargin: 0.21,
        daPctRevenue: 0.05,
        taxRate: 0.25,
        capexPctRevenue: 0.06,
        nwcPctRevenue: 0.11,
        recDays: 50, invDays: 55, payDays: 45,
        newDebt: [0, 0, 0, 0, 0],
        debtRepay: 8,
        interestRate: 0.055,
        wacc: 0.09,
        terminalGrowth: 0.028,
        exitPe: 18,
        exitEvEbitda: 13,
      }},
      bear: { label: 'Bear', assumptions: {
        revGrowth: [0.03, 0.02, 0.02, 0.01, 0.01],
        grossMargin: 0.38,
        ebitdaMargin: 0.16,
        daPctRevenue: 0.052,
        taxRate: 0.25,
        capexPctRevenue: 0.095,
        nwcPctRevenue: 0.14,
        recDays: 65, invDays: 70, payDays: 35,
        newDebt: [25, 25, 20, 15, 10],
        debtRepay: 0,
        interestRate: 0.075,
        wacc: 0.115,
        terminalGrowth: 0.02,
        exitPe: 12,
        exitEvEbitda: 8.5,
      }},
    },
    activeScenario: 'base',
    /* Comps table — static sample data the user can edit; multiples are
       computed locally from price ÷ (per-share metric). */
    comps: [
      { ticker: 'ATLS', name: 'Atlas Components (self)', price: 21.0, eps: 1.62, ebitdaPs: 2.90, bvps: 5.7, growth: 0.130, margin: 0.19, self: true },
      { ticker: 'VCX',  name: 'Vortex Industrial PLC',   price: 58.4, eps: 3.10, ebitdaPs: 4.20, bvps: 12.1, growth: 0.042, margin: 0.235, self: false },
      { ticker: 'KRA',  name: 'Krakatoa Manufacturing',  price: 31.2, eps: 1.05, ebitdaPs: 1.62, bvps: 6.8,  growth: 0.078, margin: 0.165, self: false },
      { ticker: 'NRD',  name: 'Nordwerk Precision AG',   price: 104.5, eps: 4.90, ebitdaPs: 6.40, bvps: 18.9, growth: 0.031, margin: 0.251, self: false },
      { ticker: 'SOL',  name: 'Solaris Fabrication Inc', price: 22.8, eps: 0.86, ebitdaPs: 1.31, bvps: 3.2,  growth: 0.129, margin: 0.148, self: false },
    ],
  };
}

/* ------------------------- helpers ---------------------------------- */
const sum = a => a.reduce((x, y) => x + (Number(y) || 0), 0);
const avg = a => { const v = a.filter(Number.isFinite); return v.length ? sum(v) / v.length : NaN; };
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
const numOr = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/* Validate & sanitize raw assumption input into finite numbers. */
function sanitizeAssumptions(a, n) {
  const arr = (v, dArr) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(numOr(Array.isArray(v) ? v[i] : NaN, dArr[i % dArr.length]));
    return out;
  };
  return {
    revGrowth: arr(a.revGrowth, [0, 0, 0, 0, 0]),
    grossMargin: numOr(a.grossMargin, 0.4),
    ebitdaMargin: numOr(a.ebitdaMargin, 0.2),
    daPctRevenue: numOr(a.daPctRevenue, 0.05),
    taxRate: numOr(a.taxRate, 0.25),
    capexPctRevenue: numOr(a.capexPctRevenue, 0.06),
    nwcPctRevenue: numOr(a.nwcPctRevenue, 0.12),
    recDays: numOr(a.recDays, 55),
    invDays: numOr(a.invDays, 60),
    payDays: numOr(a.payDays, 40),
    newDebt: arr(a.newDebt, [0, 0, 0, 0, 0]),
    debtRepay: numOr(a.debtRepay, 0),
    interestRate: numOr(a.interestRate, 0.06),
    wacc: numOr(a.wacc, 0.1),
    terminalGrowth: numOr(a.terminalGrowth, 0.025),
    exitPe: numOr(a.exitPe, 15),
    exitEvEbitda: numOr(a.exitEvEbitda, 10),
  };
}

/* =================== CORE ENGINE ==================================== */
/* computeModel(model, overrides)
   overrides: optional { assumptions: partial override of active scenario }
              used by sensitivity analysis without mutating state.
   Returns a full result object: statements, valuation, checks, health. */
function computeModel(model, overrides) {
  const m = clone(model);
  const key = m.scenarios[m.activeScenario] ? m.activeScenario : 'base';
  m.activeScenario = key;
  const scen = m.scenarios[key];
  const n = Math.max(1, Math.round(numOr(m.meta.forecastYears, 5)));
  m.meta.forecastYears = n;
  let A = sanitizeAssumptions(scen.assumptions, n);
  if (overrides && overrides.assumptions) {
    A = sanitizeAssumptions(Object.assign({}, A, overrides.assumptions), n);
  }

  const warnings = [];
  const errors = [];
  const addW = (sev, id, msg) => warnings.push({ sev, id, msg });

  /* sanity guards against broken / circular inputs */
  if (!Number.isFinite(A.wacc)) errors.push('WACC is not a number.');
  if (A.wacc <= A.terminalGrowth) {
    addW('high', 'wacc_tg', `WACC (${pct(A.wacc)}) must exceed terminal growth (${pct(A.terminalGrowth)}); Gordon-Growth denominator is ${denomText(A.wacc, A.terminalGrowth)}.`);
  }
  if (A.revGrowth.some(x => !Number.isFinite(x))) errors.push('Revenue growth contains non-numeric values.');
  if (A.ebitdaMargin > A.grossMargin) {
    addW('med', 'margin_impossible', `EBITDA margin (${pct(A.ebitdaMargin)}) exceeds gross margin (${pct(A.grossMargin)}); implied operating expenses would be negative.`);
  }

  /* ---------- period labels ---------- */
  const baseYear = Math.round(numOr(m.meta.baseYear, 2024));
  const years = [];
  for (let i = 0; i < n; i++) years.push(baseYear + 1 + i);

  /* ---------- INCOME STATEMENT ---------- */
  const histRev = m.history.revenue.map(Number).filter(Number.isFinite);
  const histCogs = m.history.cogs.map(Number).filter(Number.isFinite);
  const histDa = m.history.da.map(Number).filter(Number.isFinite);
  const histInterest = m.history.interest.map(Number).filter(Number.isFinite);
  const histTax = m.history.taxRate.map(Number).filter(Number.isFinite);
  const histCapex = m.history.capex.map(Number).filter(Number.isFinite);
  const histFcf = m.history.fcf.map(Number).filter(Number.isFinite);
  const histNetDebt = m.history.netDebt.map(Number).filter(Number.isFinite);
  const histCash = m.history.cash.map(Number).filter(Number.isFinite);
  const histTotalDebt = m.history.totalDebt.map(Number).filter(Number.isFinite);
  const histEbitda = m.history.ebitda.map(Number).filter(Number.isFinite);
  const hi = len => (len ? len[len.length - 1] : 0);

  /* NET-DEBT SCHEDULE (single, consistent definition — no circularity):
       ND_t = ND_{t-1} + newDebt_t − repayments_t          (financing only)
       Interest_t = ND_{t-1} × interestRate                (beginning balance)
     Free cash flow changes CASH, not the debt schedule; net debt therefore
     equals gross debt minus cash at every date once the BS rolls forward, and
     the DCF equity bridge (EV − net debt) uses exactly this schedule.        */
  const ndBeg = [], ndEnd = [];
  { let d = numOr(m.meta.netDebtStart, hi(histNetDebt));
    for (let i = 0; i < n; i++) { ndBeg.push(d); d = d + A.newDebt[i] - A.debtRepay; ndEnd.push(d); } }

  const rev = [], growthUsed = [], cogs = [], gp = [], gmCalc = [];
  const ebitda = [], emCalc = [], opex = [], da = [], ebit = [];
  const begDebt = ndBeg.slice(), endDebt = ndEnd.slice();
  const interest = [], ebt = [], tax = [], pat = [];
  let prevRev = histRev.length ? histRev[histRev.length - 1] : 0;

  for (let i = 0; i < n; i++) {
    const g = A.revGrowth[i];
    const r = prevRev * (1 + g);
    rev.push(r); growthUsed.push(g);
    const cg = r * (1 - A.grossMargin);
    cogs.push(cg);
    const gpr = r - cg; gp.push(gpr); gmCalc.push(r !== 0 ? gpr / r : NaN);
    const eb = r * A.ebitdaMargin; ebitda.push(eb); emCalc.push(r !== 0 ? eb / r : NaN);
    opex.push(gpr - eb);
    const d = r * A.daPctRevenue; da.push(d);
    const e = eb - d; ebit.push(e);
    // Interest on beginning-of-year net debt (no circularity: prior balance × rate).
    const int = ndBeg[i] * A.interestRate; interest.push(int);
    const t = e - int; ebt.push(t);
    const tx = Math.max(0, t) * A.taxRate; tax.push(tx);
    pat.push(t - tx);
    prevRev = r;
  }

  /* ---------- WORKING CAPITAL / CASH FLOW ---------- */
  const ar = [], inv = [], ap = [], nwc = [], dNwc = [];
  for (let i = 0; i < n; i++) {
    const a_ = rev[i] * A.recDays / 365;
    const iv = cogs[i] * A.invDays / 365;
    const p_ = cogs[i] * A.payDays / 365;
    ar.push(a_); inv.push(iv); ap.push(p_);
    nwc.push(a_ + iv - p_);
  }
  const nwcHistLast = histRev.length && histCogs.length
    ? hi(histRev) * A.recDays / 365 + hi(histCogs) * A.invDays / 365 - hi(histCogs) * A.payDays / 365
    : 0;
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? nwcHistLast : nwc[i - 1];
    dNwc.push(nwc[i] - prev);
  }

  const capex = rev.map(r => r * A.capexPctRevenue);
  const cfo = pat.map((p, i) => p + da[i] - dNwc[i]);
  const fcff = cfo.map((c, i) => c - capex[i]);


  /* ---------- BALANCE SHEET (derived; retained-earnings plug) -------- */
  const bs = buildBalanceSheet(m, { rev, cogs, da, capex, cfo, fcff, pat, dNwc, ndEnd: ndEnd }, A, {
    openCash: hi(histCash), openDebt: hi(histTotalDebt), openDa: hi(histDa),
  });
  const bsChecks = bsCheck(bs);
  bsChecks.forEach(c => {
    if (!c.ok) addW('high', 'bs_imbalance', `Balance-sheet check fails in ${years[c.year]}: Assets ≠ Liabilities + Equity by ${money(c.gap, m.meta.unit)} before the retained-earnings plug (>0.5% of assets). The three statements disagree about funding.`);
  });

  /* ---------- DCF (FCFF) ---------- */
  const discountFactors = [], pvFcff = [];
  for (let i = 0; i < n; i++) {
    const df = 1 / Math.pow(1 + A.wacc, i + 1);
    discountFactors.push(df);
    pvFcff.push(fcff[i] * df);
  }
  const pvExplicit = sum(pvFcff);
  const tvRaw = (A.wacc - A.terminalGrowth) > 1e-9
    ? fcff[n - 1] * (1 + A.terminalGrowth) / (A.wacc - A.terminalGrowth)
    : NaN;
  const pvTv = Number.isFinite(tvRaw) ? tvRaw * discountFactors[n - 1] : NaN;
  const evDcf = pvExplicit + (Number.isFinite(pvTv) ? pvTv : 0);
  const tvShare = Number.isFinite(evDcf) && evDcf !== 0 ? pvTv / evDcf : NaN;

  // End-of-horizon net debt taken from the same net-debt schedule the BS uses:
  const netDebtEnd = bs.netDebt[n - 1];
  const equityDcf = evDcf - netDebtEnd;
  const shares = numOr(m.meta.sharesOut, NaN);
  const impliedDcf = shares ? equityDcf / shares : NaN;

  /* ---------- Alternative valuation methods ---------- */
  const finalPat = pat[n - 1];
  const peEquity = A.exitPe * finalPat;
  const peImplied = shares ? peEquity / shares : NaN;
  const peEV = peEquity + netDebtEnd;

  const finalEbitda = ebitda[n - 1];
  const evEbitdaEV = A.exitEvEbitda * finalEbitda;
  const evEbitdaEquity = evEbitdaEV - netDebtEnd;
  const evEbitdaImplied = shares ? evEbitdaEquity / shares : NaN;

  /* ---------- Reverse DCF: solve WACC giving DCF value = market price -- */
  const targetEquity = numOr(m.meta.currentPrice, NaN) * shares;
  const targetEV = targetEquity + netDebtEnd;
  const reverse = solveReverseDcf(fcff, targetEV, A.terminalGrowth);

  /* ---------- ROIC ---------- */
  const nopat = ebit.map((e, i) => e * (1 - A.taxRate));
  const investedCapital = [];
  for (let i = 0; i < n; i++) {
    const prevNd = i === 0 ? netDebtOpening(m) : bs.netDebt[i - 1];
    const prevEq = i === 0 ? bs.openingEquity : bs.equity[i - 1];
    investedCapital.push(prevNd + prevEq);
  }
  const roic = nopat.map((np, i) => investedCapital[i] !== 0 ? np / investedCapital[i] : NaN);

  /* ---------- KPI aggregates ---------- */
  const kpi = {
    cagrHist: histCagrFrom(histRev),
    cagrFcst: n > 1 && rev[0] > 0 && rev[n - 1] > 0 ? Math.pow(rev[n - 1] / rev[0], 1 / (n - 1)) - 1 : NaN,
    avgEbitdaMargin: avg(emCalc),
    avgGrossMargin: avg(gmCalc),
    avgFcf: avg(fcff),
    totalFcf: sum(fcff),
    ndEbitdaFinal: finalEbitda !== 0 ? netDebtEnd / finalEbitda : NaN,
    ndEbitdaHist: histEbitda.length && hi(histEbitda) !== 0 ? hi(histNetDebt) / hi(histEbitda) : NaN,
    peakNdEbitda: peakNdEbitda(bs.netDebt, bs.cash, ebitda),
    upsideDcf: Number.isFinite(impliedDcf) && m.meta.currentPrice ? impliedDcf / m.meta.currentPrice - 1 : NaN,
  };

  /* ---------- RED FLAGS ---------- */
  runRedFlags(m, years, { A, rev, ebitda, fcff, cfo, pat, bs, bsChecks, tvShare, growthUsed, endDebt, warnings, errors, kpi, histRev });

  /* ---------- HEALTH SCORE ---------- */
  const health = computeHealth(m, { bsChecks, fcff, cfo, pat, tvShare, A, warnings, errors });

  /* ---------- formula trace strings (transparency panel) ---------- */
  const formulas = buildFormulas(m, A, years, {
    rev, growthUsed, cogs, gp, ebitda, opex, da, ebit, begDebt, interest, ebt, tax, pat,
    dNwc, cfo, capex, fcff, discountFactors, pvFcff, pvExplicit, tvRaw, pvTv, evDcf,
    netDebtEnd, equityDcf, impliedDcf, bs, reverse, roic, nopat, investedCapital,
    ar, inv, ap, targetEV, peEquity, peImplied, peEV, evEbitdaEV, evEbitdaEquity, evEbitdaImplied, tvShare, finalPat, finalEbitda,
    debtEnd: endDebt[n - 1],
  });

  return {
    ok: errors.length === 0,
    errors,
    scenarioKey: key,
    scenarioLabel: scen.label || key,
    meta: m.meta,
    history: m.history,
    assumptions: A,
    years,
    is: { revenue: rev, growth: growthUsed, cogs, grossProfit: gp, grossMargin: gmCalc, ebitda, ebitdaMargin: emCalc, opex, da, ebit, begDebt, interest, ebt, tax, pat },
    cf: { da, dNwc, cfo, capex, fcff },
    wc: { ar, inv, ap, nwc },
    bs, bsChecks,
    debt: { beg: begDebt, end: endDebt },
    dcf: { discountFactors, pvFcff, pvExplicit, tvRaw, pvTv, ev: evDcf, netDebtEnd, equity: equityDcf, implied: impliedDcf, tvShare },
    alt: { pe: { equity: peEquity, implied: peImplied, ev: peEV }, evEbitda: { ev: evEbitdaEV, equity: evEbitdaEquity, implied: evEbitdaImplied } },
    reverse,
    roic, nopat, investedCapital,
    kpi,
    warnings,
    health,
    formulas,
    unit: m.meta.unit || 'M',
  };
}

function netDebtOpening(m) {
  return numOr(m.meta.netDebtStart, m.history.netDebt.length ? m.history.netDebt[m.history.netDebt.length - 1] : 0);
}

/* ---------- derived balance sheet with retained-earnings plug --------- */
function buildBalanceSheet(m, s, A, open) {
  const rows = {
    cash: [], ppe: [], otherAssets: [], ar: [], inv: [], totalAssets: [],
    debt: [], netDebt: [], ap: [], otherLiab: [], retainedPlug: [], equity: [], totalLE: [], rawGap: [], cfRoll: [],
  };
  rows.openingEquity = numOr(m.meta.bookEquityStart, numOr(m.history.openingEquity, 0));
  if (!Number.isFinite(rows.openingEquity) || rows.openingEquity === 0) {
    rows.openingEquity = fallbackOpeningEquity(m, open);
  }
  let cash = open.openCash;
  let ppe = numOr(m.history.ppeNet, open.openDa * 5);          // net PP&E start
  let depAcc = numOr(m.history.depAcc, open.openDa * 8 - ppe); // accumulated depreciation
  let otherA = numOr(m.history.otherAssets, 0);
  let otherL = numOr(m.history.otherLiab, 0);
  let eq = rows.openingEquity;
  const n = s.rev.length;
  for (let i = 0; i < n; i++) {
    const ar = s.rev[i] * A.recDays / 365;
    const inv = s.cogs[i] * A.invDays / 365;
    const ap = s.cogs[i] * A.payDays / 365;
    const grossPpe = ppe + depAcc + s.capex[i];
    const newDepAcc = Math.min(s.da[i] + depAcc, Math.max(0, grossPpe - 0.01));
    ppe = grossPpe - newDepAcc;
    depAcc = newDepAcc;
    const nd = s.ndEnd[i]; // single net-debt schedule (engine computes it)
    // Cash rolls forward per the cash-flow statement:
    //   ΔCash = CFO − Capex + New debt − Repayments
    cash = cash + s.cfo[i] - s.capex[i] + A.newDebt[i] - A.debtRepay;
    // Gross debt = net debt + cash ⇒ Assets ≡ Liabilities + Equity reduces
    // algebraically to  CF: ΔCash = CFO − Capex + Δdebt  (true by construction).
    const grossDebt = Math.max(0, nd + cash);
    // Equity roll-forward: prior equity + PAT (no dividends modeled).
    eq = eq + s.pat[i];
    const ta = cash + ppe + otherA + ar + inv;
    // Raw residual before plug (should be ~0; flagged if material). The
    // displayed plug keeps the printed sheet balanced and honest.
    const rawGap = ta - (grossDebt + ap + otherL + eq);
    const plug = Number.isFinite(rawGap) ? rawGap : NaN;
    rows.cash.push(cash); rows.ppe.push(ppe); rows.otherAssets.push(otherA);
    rows.ar.push(ar); rows.inv.push(inv); rows.totalAssets.push(ta);
    rows.debt.push(grossDebt); rows.netDebt.push(nd); rows.ap.push(ap); rows.otherLiab.push(otherL);
    rows.retainedPlug.push(plug);
    rows.equity.push(eq + plug); rows.totalLE.push(grossDebt + ap + otherL + eq + plug);
    rows.rawGap.push(rawGap);
  }
  return rows;
}
function hi0(v) { return Number.isFinite(v) ? v : 0; }
function fallbackOpeningEquity(m, open) {
  // Assets − liabilities using simple heuristics so the sheet starts balanced.
  const revLast = m.history.revenue.length ? m.history.revenue[m.history.revenue.length - 1] : 0;
  const cogsLast = m.history.cogs.length ? m.history.cogs[m.history.cogs.length - 1] : 0;
  const A = m.scenarios[m.activeScenario].assumptions;
  const ar = revLast * numOr(A.recDays, 55) / 365;
  const inv = cogsLast * numOr(A.invDays, 60) / 365;
  const ap = cogsLast * numOr(A.payDays, 40) / 365;
  const ppe = numOr(m.history.ppeNet, open.openDa * 5);
  const assets = open.openCash + ppe + ar + inv;
  const liabs = open.openDebt + ap;
  return Math.max(assets - liabs, 0.001);
}

function bsCheck(bs) {
  // Post-plug Assets ≡ L+E holds identically (the plug is shown, never hidden).
  // The genuine integrity test is rawGap: the pre-plug difference between
  // derived assets and liabilities+equity. Material rawGap ⇒ the three
  // statements disagree about where cash went (e.g. burn without issuance).
  const out = [];
  for (let i = 0; i < bs.totalAssets.length; i++) {
    const diff = bs.totalAssets[i] - bs.totalLE[i];   // 0 by construction
    const gap = bs.rawGap[i];                          // real integrity signal
    const tol = Math.max(1e-9, Math.abs(bs.totalAssets[i]) * 0.005);
    out.push({ year: i, diff, gap, ok: Math.abs(diff) <= 1e-9 && Math.abs(gap) <= tol });
  }
  return out;
}

/* ---------- reverse DCF bisection ------------------------------------ */
function solveReverseDcf(fcff, targetEV, tg) {
  const n = fcff.length;
  const valueAt = w => {
    if (w - tg <= 1e-9) return Infinity;
    const pv = fcff.reduce((s_, f, i) => s_ + f / Math.pow(1 + w, i + 1), 0);
    const tv = fcff[n - 1] * (1 + tg) / (w - tg) / Math.pow(1 + w, n);
    return pv + tv;
  };
  if (!Number.isFinite(targetEV)) return { wacc: NaN, status: 'no-market-price' };
  let lo = 0.0001, hiB = 2.0;
  const vlo = valueAt(lo), vhi = valueAt(hiB);
  if (targetEV > vlo) return { wacc: NaN, status: 'no-solution: market price implies EV above any WACC ≥ 0.01% (growth beyond horizon?)' };
  if (targetEV < vhi) return { wacc: NaN, status: 'no-solution: market price implies WACC above 200%' };
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hiB) / 2, v = valueAt(mid);
    if (Math.abs(v - targetEV) / Math.max(1e-9, Math.abs(targetEV)) < 1e-9) { lo = hiB = mid; break; }
    if (v > targetEV) lo = mid; else hiB = mid;
  }
  return { wacc: (lo + hiB) / 2, status: 'ok' };
}

/* ---------- historical metrics ---------------------------------------- */
function histCagrFrom(r) {
  if (r.length < 2 || r[0] <= 0 || r[r.length - 1] <= 0) return NaN;
  return Math.pow(r[r.length - 1] / r[0], 1 / (r.length - 1)) - 1;
}
function peakNdEbitda(netDebtArr, cash, ebitda) {
  let best = -Infinity;
  for (let i = 0; i < netDebtArr.length; i++) {
    const v = ebitda[i] ? netDebtArr[i] / ebitda[i] : NaN;
    if (Number.isFinite(v) && v > best) best = v;
  }
  return Number.isFinite(best) ? best : NaN;
}

/* ---------- red flags -------------------------------------------------- */
function runRedFlags(m, years, ctx) {
  const { A, fcff, cfo, pat, bs, bsChecks, tvShare, growthUsed, endDebt, warnings, errors, kpi, histRev } = ctx;
  const add = (sev, id, msg) => warnings.push({ sev, id, msg });

  // Negative FCF
  fcff.forEach((f, i) => { if (f < 0) add('med', 'neg_fcf', `Forecast FCFF is negative in ${years[i]} (${money(f, m.meta.unit)}).`); });

  // Excessive terminal value contribution
  if (Number.isFinite(tvShare)) {
    if (tvShare > 0.75) add('high', 'tv_dominant', `Terminal value is ${pct(tvShare)} of enterprise value (>75%) — valuation rests mostly on unforecastable assumptions.`);
    else if (tvShare > 0.65) add('med', 'tv_high', `Terminal value contributes ${pct(tvShare)} of enterprise value (>65%).`);
  }

  // Unrealistic terminal growth
  const histG = kpi.cagrHist;
  if (A.terminalGrowth > 0.03) add('high', 'tg_unrealistic', `Terminal growth ${pct(A.terminalGrowth)} exceeds the ~3% long-run nominal GDP benchmark — unsustainable in perpetuity.`);
  else if (A.terminalGrowth > 0.025) add('low', 'tg_elevated', `Terminal growth ${pct(A.terminalGrowth)} is above typical 2–2.5% steady-state assumptions.`);
  if (Number.isFinite(histG) && A.terminalGrowth > histG) add('med', 'tg_above_hist', `Terminal growth (${pct(A.terminalGrowth)}) exceeds historical revenue CAGR (${pct(histG)}).`);

  // Large deviation from historical growth
  if (Number.isFinite(histG)) {
    growthUsed.forEach((g, i) => {
      if (Math.abs(g - histG) > 0.10) add('med', 'growth_deviation', `Year ${years[i]} revenue growth ${pct(g)} deviates >10pp from historical CAGR ${pct(histG)}.`);
    });
  }

  // Rapid debt accumulation
  const htd = m.history.totalDebt.map(Number).filter(Number.isFinite);
  let prevDebt = htd.length ? htd[htd.length - 1] : endDebt[0];
  endDebt.forEach((d, i) => {
    if (prevDebt > 0 && (d - prevDebt) / prevDebt > 0.25) add('med', 'debt_spike', `Debt rises ${pct((d - prevDebt) / prevDebt)} in ${years[i]} (>25% YoY).`);
    prevDebt = d;
  });
  if (Number.isFinite(kpi.peakNdEbitda) && kpi.peakNdEbitda > 4.0) add('high', 'leverage', `Peak Net Debt/EBITDA reaches ${num2(kpi.peakNdEbitda)}× (>4.0× threshold).`);

  // Falling cash despite positive earnings / negative cash
  const hc = m.history.cash.map(Number).filter(Number.isFinite);
  for (let i = 0; i < bs.cash.length; i++) {
    const prevCash = i === 0 ? (hc.length ? hc[hc.length - 1] : bs.cash[0]) : bs.cash[i - 1];
    if (pat[i] > 0 && bs.cash[i] < prevCash) add('med', 'cash_decline', `Cash falls in ${years[i]} (${money(prevCash, m.meta.unit)} → ${money(bs.cash[i], m.meta.unit)}) despite positive PAT.`);
    if (bs.cash[i] < 0) add('high', 'cash_negative', `Projected cash balance is negative in ${years[i]} (${money(bs.cash[i], m.meta.unit)}) — funding gap.`);
  }

  // CFO materially below PAT
  for (let i = 0; i < cfo.length; i++) {
    if (pat[i] > 0 && cfo[i] < pat[i] * 0.7) add('med', 'cfo_pat', `CFO (${money(cfo[i], m.meta.unit)}) is >30% below PAT (${money(pat[i], m.meta.unit)}) in ${years[i]} — earnings-quality concern.`);
  }

  // Extreme valuation sensitivity (recompute EV at ±1pp WACC)
  const n = fcff.length;
  const evAt = w => {
    if (w - A.terminalGrowth <= 1e-9) return NaN;
    const pv = fcff.reduce((s_, f, i) => s_ + f / Math.pow(1 + w, i + 1), 0);
    const tv = fcff[n - 1] * (1 + A.terminalGrowth) / (w - A.terminalGrowth) / Math.pow(1 + w, n);
    return pv + tv;
  };
  const base = evAt(A.wacc), up = evAt(A.wacc + 0.01), dn = evAt(A.wacc - 0.01);
  if ([base, up, dn].every(Number.isFinite) && base !== 0) {
    const swing = Math.abs(up - dn) / Math.abs(base);
    if (swing > 0.60) add('med', 'extreme_sensitivity', `EV moves ${pct(swing)} for a ±1pp WACC change — extreme valuation sensitivity.`);
  }

  // Broken formulas check
  const bad = [ctx.rev, ctx.ebitda, fcff, cfo].some(arr => arr.some(x => !Number.isFinite(x)));
  if (bad) add('high', 'broken_formula', 'One or more model outputs evaluated to NaN/Infinity — check inputs for non-numeric values.');
}

/* ---------- health score (objective checks only) ---------------------- */
function computeHealth(m, ctx) {
  const { bsChecks, fcff, cfo, pat, tvShare, A, warnings, errors } = ctx;
  const items = [];
  const add = (name, pass, detail) => items.push({ name, pass: !!pass, detail: detail || '' });

  add('Balance sheet balances every year', bsChecks.every(c => c.ok), bsChecks.filter(c => !c.ok).length ? `${bsChecks.filter(c => !c.ok).length} year(s) off` : 'Assets = L+E, all years');
  add('No NaN / broken formulas', errors.length === 0 && !warnings.some(w => w.id === 'broken_formula'), errors.length ? errors.join('; ') : 'All outputs finite');
  add('Positive FCFF in every forecast year', fcff.every(f => Number.isFinite(f) && f >= 0), '');
  add('CFO ≥ 70% of PAT (all years)', cfo.every((c, i) => pat[i] <= 0 || c >= pat[i] * 0.7), '');
  add('TV ≤ 75% of enterprise value', !(Number.isFinite(tvShare) && tvShare > 0.75), Number.isFinite(tvShare) ? `TV share ${pct(tvShare)}` : 'n/a');
  add('Terminal growth ≤ 3%', A.terminalGrowth <= 0.03, `g = ${pct(A.terminalGrowth)}`);
  add('WACC > terminal growth', A.wacc > A.terminalGrowth, `spread ${pct(A.wacc - A.terminalGrowth)}`);
  add('EBITDA margin ≤ gross margin', A.ebitdaMargin <= A.grossMargin + 1e-9, '');
  add('No negative projected cash', !warnings.some(w => w.id === 'cash_negative'), '');
  add('Peak leverage ≤ 4× Net Debt/EBITDA', !warnings.some(w => w.id === 'leverage'), '');

  const passed = items.filter(i => i.pass).length;
  const score = Math.round(100 * passed / items.length);
  const grade = score >= 90 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Caution' : 'Poor';
  return { score, grade, items, passed, total: items.length };
}

/* ---------- formula transparency panel -------------------------------- */
function buildFormulas(m, A, years, c) {
  const u = m.meta.unit, lines = [];
  const M = v => money(v, u), P = v => pct(v), N = v => num2(v);
  const n = years.length;
  const L = (title, body) => lines.push({ title, body });

  L('Income statement chain',
    `Revenueₜ = Revenueₜ₋₁ × (1 + gₜ)\n` +
    `COGSₜ = Revenueₜ × (1 − Gross margin ${P(A.grossMargin)})\n` +
    `Gross profit = Revenue − COGS\n` +
    `EBITDA = Revenue × EBITDA margin ${P(A.ebitdaMargin)}\n` +
    `OpEx = Gross profit − EBITDA\n` +
    `D&A = Revenue × ${P(A.daPctRevenue)}\n` +
    `EBIT = EBITDA − D&A\n` +
    `Interestₜ = Beginning debtₜ × ${P(A.interestRate)}\n` +
    `EBT = EBIT − Interest\n` +
    `Tax = max(EBT, 0) × ${P(A.taxRate)}  (no tax benefit on losses)\n` +
    `PAT = EBT − Tax\n` +
    `Worked example ${years[n - 1]}: Rev ${M(c.rev[n - 1])} ⇒ EBITDA ${M(c.ebitda[n - 1])} ⇒ EBIT ${M(c.ebit[n - 1])} ⇒ PAT ${M(c.pat[n - 1])}`);

  L('Working capital',
    `Receivables = Revenue × RecDays/365 = ${M(c.ar[n - 1])} (${years[n - 1]})\n` +
    `Inventory = COGS × InvDays/365 = ${M(c.inv[n - 1])}\n` +
    `Payables = COGS × PayDays/365 = ${M(c.ap[n - 1])}\n` +
    `NWC = Receivables + Inventory − Payables\n` +
    `ΔNWC = NWCₜ − NWCₜ₋₁  (an increase consumes cash)`);

  L('Cash flow & FCFF',
    `CFO = PAT + D&A − ΔNWC\n` +
    `FCFF = CFO − Capex, where Capex = Revenue × ${P(A.capexPctRevenue)}\n` +
    `Worked example ${years[n - 1]}: PAT ${M(c.pat[n - 1])} + D&A ${M(c.da[n - 1])} − ΔNWC ${M(c.dNwc[n - 1])} = CFO ${M(c.cfo[n - 1])}; − Capex ${M(c.capex[n - 1])} ⇒ FCFF ${M(c.fcff[n - 1])}`);

  L('DCF (FCFF method)',
    `PV(FCFFₜ) = FCFFₜ ÷ (1+WACC)^t,  WACC = ${P(A.wacc)}\n` +
    `Σ PV(explicit) = ${M(c.pvExplicit)}\n` +
    `TV = FCFFₙ × (1+g) ÷ (WACC−g) = ${M(c.fcff[n - 1])} × (1+${P(A.terminalGrowth)}) ÷ (${P(A.wacc)} − ${P(A.terminalGrowth)}) = ${M(c.tvRaw)}\n` +
    `PV(TV) = TV ÷ (1+WACC)^${n} = ${M(c.pvTv)}\n` +
    `EV = Σ PV + PV(TV) = ${M(c.evDcf)}   (TV = ${P(c.tvShare)} of EV)\n` +
    `Net debt(end) = Debt schedule ${M(c.debtEnd)} (= gross ${M(c.bs.debt[n - 1])} − cash ${M(c.bs.cash[n - 1])})\n` +
    `Equity value = EV − Net debt = ${M(c.equityDcf)}\n` +
    `Implied price = Equity ÷ Shares(${N(m.meta.sharesOut)}M) = ${M(c.impliedDcf)}/share`);

  L('P/E valuation',
    `Equity value = Exit P/E × Final-year PAT = ${N(A.exitPe)} × ${M(c.finalPat)} = ${M(c.peEquity)}\n` +
    `Implied price = ${M(c.peImplied)}/share\n` +
    `Implied EV = Equity + Net debt = ${M(c.peEV)}`);

  L('EV/EBITDA valuation',
    `EV = Exit multiple × Final-year EBITDA = ${N(A.exitEvEbitda)} × ${M(c.finalEbitda)} = ${M(c.evEbitdaEV)}\n` +
    `Equity = EV − Net debt = ${M(c.evEbitdaEquity)}\n` +
    `Implied price = ${M(c.evEbitdaImplied)}/share`);

  L('Reverse DCF',
    `Solve for the WACC* that makes DCF EV equal the EV implied by the market price:\n` +
    `Target EV = Price ${M(m.meta.currentPrice)}/sh × ${N(m.meta.sharesOut)}M sh + Net debt ${M(c.netDebtEnd)} = ${M(c.targetEV)}\n` +
    `Method: bisection over WACC ∈ (0%, 200%], monotone because EV decreases as WACC rises.\n` +
    `Solution: WACC* = ${P(c.reverse.wacc)}  (status: ${c.reverse.status})`);

  L('ROIC',
    `NOPAT = EBIT × (1 − tax rate ${P(A.taxRate)})\n` +
    `Invested capitalₜ = prior-year net debt + prior-year book equity\n` +
    `ROICₜ = NOPATₜ ÷ Invested capitalₜ\n` +
    `${years[n - 1]}: NOPAT ${M(c.nopat[n - 1])} ÷ IC ${M(c.investedCapital[n - 1])} = ${P(c.roic[n - 1])}; spread vs WACC = ${P(c.roic[n - 1] - A.wacc)}`);

  L('Balance sheet construction',
    `PP&Eₜ = PP&Eₜ₋₁ + Capex − D&A\n` +
    `Cashₜ = Cashₜ₋₁ + CFO − Capex + New debt − Repayments\n` +
    `Equityₜ = Equityₜ₋₁ + PATₜ (no dividends modeled).\n` +
    `Displayed plug = Assets − (Gross debt + Payables + Other liab. + Equityₜ). With internally consistent statements the plug ≈ 0; a material plug exposes an assumption conflict (e.g. cash burn funded without matching debt issuance).\n` +
    `Gross debt on the balance sheet = net-debt schedule + cash.`);

  return lines;
}

/* ---------- formatting utilities --------------------------------------- */
function money(v, unit) {
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const av = Math.abs(v);
  return `${sign}$${av.toFixed(av >= 1000 ? 0 : av >= 10 ? 1 : 2)}${unit || ''}`;
}
function pct(v, dp) {
  if (!Number.isFinite(v)) return '—';
  return (v * 100).toFixed(dp == null ? 1 : dp) + '%';
}
function num2(v) { return Number.isFinite(v) ? v.toFixed(2) : '—'; }
function mult(v) { return Number.isFinite(v) ? v.toFixed(1) + '×' : '—'; }
function denomText(w, g) { const d = w - g; return Number.isFinite(d) ? (d <= 0 ? 'negative/zero (Gordon Growth breaks)' : pct(d)) : 'invalid'; }

/* expose */
if (typeof window !== 'undefined') {
  window.FMP = { createDefaultModel, computeModel, clone, sanitizeAssumptions, UNITS, money, pct, num2, mult };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createDefaultModel, computeModel, clone, sanitizeAssumptions, money, pct, num2, mult };
}
