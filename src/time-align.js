/**
 * Align scoring events to Polymarket chart time.
 * Uses visible axis labels to map times → pixel positions.
 */
const marketMetaCache = new Map();
const priceHistoryCache = new Map();

const CHART_MARKET_TYPE = {
  main: "moneyline",
  moneyline: "moneyline",
  spread: "spreads",
  total: "totals",
};

function parsePolyDate(str) {
  if (!str) return NaN;
  let iso = str;
  if (!iso.includes("T")) iso = iso.replace(" ", "T");
  iso = iso.replace(/\+00$/, "Z").replace(/\+00:00$/, "Z");
  return Date.parse(iso);
}

function parseTokenIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function parseLabelToLocalMs(label, anchorMs) {
  const m = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;

  const ref = new Date(anchorMs);
  const candidates = [-1, 0, 1].map((dayOff) => {
    const d = new Date(ref);
    d.setDate(d.getDate() + dayOff);
    d.setHours(h, min, 0, 0);
    return d.getTime();
  });

  return candidates.sort(
    (a, b) => Math.abs(a - anchorMs) - Math.abs(b - anchorMs)
  )[0];
}

function getLayoutElement(chartRoot) {
  const canvas = getCanvas(chartRoot);
  if (canvas?.isConnected) return canvas;
  return getPlotArea(chartRoot);
}

/** Never treat our score table/panel as chart axis labels */
function isExtensionUi(el) {
  return Boolean(
    el.closest?.(
      ".poly-score-root, .poly-score-markers, .ps-timeline-scroll, .ps-timeline-rows"
    )
  );
}

function findAxisLabelsNearPlot(layoutEl, chartRoot) {
  if (!layoutEl) return [];

  const cRect = layoutEl.getBoundingClientRect();
  const searchRoots = [];
  let node = chartRoot || layoutEl.parentElement;
  for (let i = 0; i < 8 && node; i++) {
    searchRoots.push(node);
    node = node.parentElement;
  }

  const found = [];
  const seen = new Set();
  const timeRe = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;

  for (const root of searchRoots) {
    for (const el of root.querySelectorAll("text, tspan, span, div, p, label")) {
      if (isExtensionUi(el)) continue;

      const t = (el.textContent || "").trim();
      if (!t || !timeRe.test(t)) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      const key = `${t}-${Math.round(r.left)}`;
      if (seen.has(key)) continue;

      const nearX = r.right >= cRect.left - 50 && r.left <= cRect.right + 50;
      const nearY = r.top >= cRect.bottom - 90 && r.top <= cRect.bottom + 120;

      if (nearX && nearY) {
        seen.add(key);
        found.push({ text: t, x: r.left + r.width / 2 });
      }
    }
  }

  return found.sort((a, b) => a.x - b.x);
}

function buildAxisTicks(labelPoints, layoutEl, anchorMs) {
  const plotRect = layoutEl.getBoundingClientRect();
  const plotLeft = plotRect.left;
  const plotWidth = plotRect.width;
  if (plotWidth < 10) return [];

  const ticks = labelPoints
    .map((lp) => ({
      time: parseLabelToLocalMs(lp.text, anchorMs),
      ratio: (lp.x - plotLeft) / plotWidth,
    }))
    .filter((t) => t.time)
    .sort((a, b) => a.time - b.time);

  const byMinute = new Map();
  for (const tick of ticks) {
    const key = Math.round(tick.time / 60000);
    if (!byMinute.has(key)) byMinute.set(key, tick);
  }
  return [...byMinute.values()].sort((a, b) => a.time - b.time);
}

function derivePlotTimeBounds(ticks) {
  if (ticks.length < 2) return null;

  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  const ratioSpan = last.ratio - first.ratio;
  const timeSpan = last.time - first.time;
  if (Math.abs(ratioSpan) < 0.001 || timeSpan <= 0) return null;

  const msPerRatio = timeSpan / ratioSpan;
  return {
    start: first.time - first.ratio * msPerRatio,
    end: last.time + (1 - last.ratio) * msPerRatio,
  };
}

function positionOnRange(eventTs, start, end) {
  if (!eventTs || !start || !end || end <= start) return null;
  const ratio = (eventTs - start) / (end - start);
  if (ratio < -0.05 || ratio > 1.05) return null;
  return Math.max(0, Math.min(1, ratio));
}

function interpolateOnAxis(eventTs, ticks) {
  if (!ticks.length) return null;

  const first = ticks[0];
  const last = ticks[ticks.length - 1];

  if (eventTs <= first.time) {
    if (ticks.length < 2) return first.ratio;
    const span = ticks[1].time - first.time || 1;
    const slope = (ticks[1].ratio - first.ratio) / span;
    return first.ratio + slope * (eventTs - first.time);
  }

  if (eventTs >= last.time) {
    if (ticks.length < 2) return last.ratio;
    const prev = ticks[ticks.length - 2];
    const span = last.time - prev.time || 1;
    const slope = (last.ratio - prev.ratio) / span;
    return last.ratio + slope * (eventTs - last.time);
  }

  for (let i = 0; i < ticks.length - 1; i++) {
    const a = ticks[i];
    const b = ticks[i + 1];
    if (eventTs >= a.time && eventTs <= b.time) {
      const span = b.time - a.time || 1;
      return a.ratio + ((eventTs - a.time) / span) * (b.ratio - a.ratio);
    }
  }

  return null;
}

async function fetchEventMarkets(slug) {
  if (marketMetaCache.has(slug)) return marketMetaCache.get(slug);

  try {
    const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
    const data = await res.json();
    const event = data?.[0];
    if (!event?.markets?.length) {
      marketMetaCache.set(slug, null);
      return null;
    }

    const byType = {};
    for (const market of event.markets) {
      const type = market.sportsMarketType;
      if (!type || byType[type]) continue;
      const tokens = parseTokenIds(market.clobTokenIds);
      if (!tokens.length) continue;
      byType[type] = {
        tokenId: tokens[0],
        gameStart: parsePolyDate(market.gameStartTime),
        gameEnd: parsePolyDate(market.closedTime || market.endDate),
      };
    }

    marketMetaCache.set(slug, byType);
    return byType;
  } catch {
    marketMetaCache.set(slug, null);
    return null;
  }
}

async function fetchPriceHistory(tokenId, gameStart, gameEnd) {
  if (!tokenId || !gameStart || !gameEnd) return null;

  const key = `${tokenId}-${gameStart}-${gameEnd}`;
  if (priceHistoryCache.has(key)) return priceHistoryCache.get(key);

  try {
    const startTs = Math.floor(gameStart / 1000);
    const endTs = Math.ceil(gameEnd / 1000);
    const res = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=1`
    );
    const data = await res.json();
    const history = data?.history || [];
    priceHistoryCache.set(key, history.length ? history : null);
    return history.length ? history : null;
  } catch {
    priceHistoryCache.set(key, null);
    return null;
  }
}

function pickMarketMeta(markets, chartType) {
  if (!markets) return null;
  const key = CHART_MARKET_TYPE[chartType] || "moneyline";
  return markets[key] || markets.moneyline || Object.values(markets)[0] || null;
}

async function resolveChartAlignment(chartRoot, timeline, slug, chartType = "main") {
  const slugStr =
    slug
      ? `mlb-${slug.away}-${slug.home}-${slug.date}`
      : location.pathname.match(/mlb-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}/)?.[0];

  const detectedType = chartType === "main" ? detectChartType(chartRoot) : chartType;
  const markets = slugStr ? await fetchEventMarkets(slugStr) : null;
  const meta = pickMarketMeta(markets, detectedType);

  const gameStart =
    meta?.gameStart || Date.parse(timeline.game.gameDate);
  const gameEnd =
    meta?.gameEnd ||
    Math.max(...timeline.events.map((e) => e.timestamp)) + 20 * 60 * 1000;

  const history = meta?.tokenId
    ? await fetchPriceHistory(meta.tokenId, gameStart, gameEnd)
    : null;

  const alignment = {
    chartRoot,
    gameStart,
    gameEnd,
    history,
    layoutEl: getLayoutElement(chartRoot),
    axisTicks: [],
    plotBounds: null,
    positionFn(eventTs) {
      if (!eventTs) return null;

      const ticks = alignment.axisTicks;

      if (ticks.length >= 2) {
        const bounds = alignment.plotBounds || derivePlotTimeBounds(ticks);
        if (bounds) {
          const pos = positionOnRange(eventTs, bounds.start, bounds.end);
          if (pos !== null) return pos;
        }

        const pos = interpolateOnAxis(eventTs, ticks);
        if (pos !== null) {
          if (pos < 0 || pos > 1) return null;
          return pos;
        }
      }

      const rangeStart = history?.length ? history[0].t * 1000 : gameStart;
      const rangeEnd = history?.length
        ? history[history.length - 1].t * 1000
        : gameEnd;

      const span = rangeEnd - rangeStart;
      if (span > 0) {
        const lag = span * 0.033;
        const calibratedStart = rangeStart + lag;
        const pos = positionOnRange(eventTs, calibratedStart, rangeEnd);
        if (pos !== null) return pos;
      }

      return positionOnRange(eventTs, rangeStart, rangeEnd);
    },
    refreshAxis() {
      const el = alignment.plot || alignment.layoutEl || getLayoutElement(chartRoot);
      if (!el?.isConnected) return;
      alignment.layoutEl = el;

      const labelPoints = findAxisLabelsNearPlot(el, chartRoot);
      const ticks = buildAxisTicks(labelPoints, el, gameStart);
      alignment.axisTicks = ticks;
      alignment.plotBounds = ticks.length >= 2 ? derivePlotTimeBounds(ticks) : null;
    },
  };

  alignment.refreshAxis();
  return alignment;
}

window.PolyScoreTime = { resolveChartAlignment };
window.resolveChartAlignment = resolveChartAlignment;
