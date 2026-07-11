/**
 * Detect Polymarket charts via SVG plot rects + page context
 */
const CHART_MARKERS = ["1H", "6H", "1D", "1W", "1M", "ALL"];
const PROCESSED_ATTR = "data-poly-score-id";

const plotByRoot = new WeakMap();
const chartRootsCache = { roots: null };

function hasChartSignals(el) {
  if (!el) return false;
  let hits = 0;
  for (const node of el.querySelectorAll("button, [role='button']")) {
    const t = node.textContent?.trim();
    if (t && CHART_MARKERS.includes(t)) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

function isGraphPlotRect(el) {
  if (!el || el.tagName?.toLowerCase() !== "rect") return false;

  const fill = (el.getAttribute("fill") || "").toLowerCase();
  if (fill !== "transparent") return false;

  const x = parseFloat(el.getAttribute("x") || "0");
  const y = parseFloat(el.getAttribute("y") || "0");
  if (x !== 0 || y !== 0) return false;

  const w = parseFloat(el.getAttribute("width") || "0");
  const h = parseFloat(el.getAttribute("height") || "0");

  return w >= 400 && h >= 90 && h <= 320;
}

function findAllPlotRects() {
  return [...document.querySelectorAll('rect[fill="transparent"]')].filter(
    isGraphPlotRect
  );
}

function findChartRootFromPlotRect(plotRect) {
  const svg = plotRect.closest("svg");
  let node = svg?.parentElement || plotRect.parentElement;

  for (let i = 0; i < 16 && node; i++) {
    if (hasChartSignals(node)) return node;
    node = node.parentElement;
  }

  return svg?.parentElement || plotRect;
}

function detectChartType(chartRoot) {
  let node = chartRoot;
  for (let i = 0; i < 10 && node; i++) {
    const text = (node.textContent || "").slice(0, 200);
    if (/Spreads/i.test(text) && text.includes("Vol")) return "spread";
    if (/Totals/i.test(text) && text.includes("Vol")) return "total";
    if (/Moneyline/i.test(text) && text.includes("Vol")) return "moneyline";
    node = node.parentElement;
  }
  return "main";
}

function isChartContainer(el) {
  if (!el) return false;
  if (isChartAttached(el)) return false;

  const plot = plotByRoot.get(el);
  const canvas = el.querySelector("canvas");

  if (plot) {
    const r = plot.getBoundingClientRect();
    if (r.width >= 200 && r.height >= 60) return true;
  }

  if (canvas) {
    const r = canvas.getBoundingClientRect();
    if (r.width >= 80 && r.height >= 40 && hasChartSignals(el)) return true;
  }

  return false;
}

function registerChartRoot(chartRoot, plotRect) {
  plotByRoot.set(chartRoot, plotRect);
}

function invalidateChartCache() {
  chartRootsCache.roots = null;
}

function findChartRoots() {
  if (chartRootsCache.roots) {
    const alive = chartRootsCache.roots.filter((r) => r.isConnected);
    if (alive.length === chartRootsCache.roots.length) return alive;
  }

  const roots = new Map();

  for (const plotRect of findAllPlotRects()) {
    const root = findChartRootFromPlotRect(plotRect);
    if (!root) continue;

    const r = plotRect.getBoundingClientRect();
    if (r.width < 200 || r.height < 50) continue;

    const key = `${Math.round(r.top)}-${Math.round(r.left)}-${Math.round(r.width)}`;
    if (!roots.has(key)) {
      registerChartRoot(root, plotRect);
      roots.set(key, root);
    }
  }

  if (roots.size === 0) {
    for (const canvas of document.querySelectorAll("canvas")) {
      let node = canvas.parentElement;
      for (let i = 0; i < 12 && node; i++) {
        if (hasChartSignals(node) && !roots.has(String(node))) {
          roots.set(String(node), node);
          break;
        }
        node = node.parentElement;
      }
    }
  }

  chartRootsCache.roots = [...roots.values()];
  return chartRootsCache.roots;
}

function getPlotRect(chartRoot) {
  const stored = plotByRoot.get(chartRoot);
  if (stored?.isConnected) return stored;

  const plot = [...chartRoot.querySelectorAll("rect")].find(isGraphPlotRect);
  if (plot) {
    plotByRoot.set(chartRoot, plot);
    return plot;
  }

  return null;
}

function getCanvas(chartRoot) {
  const canvases = [...chartRoot.querySelectorAll("canvas")];
  return canvases.sort(
    (a, b) =>
      b.getBoundingClientRect().width * b.getBoundingClientRect().height -
      a.getBoundingClientRect().width * a.getBoundingClientRect().height
  )[0];
}

/** Plot area used for marker positioning — prefers SVG transparent rect */
function getPlotArea(chartRoot) {
  return getPlotRect(chartRoot) || getCanvas(chartRoot);
}

function extractSlugFromCard(card) {
  const link = card.querySelector('a[href*="/sports/mlb/mlb-"]');
  if (link) {
    const href = link.href || link.getAttribute("href") || "";
    const m = href.match(/mlb-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}/);
    if (m) return parseGameSlug(m[0]);
  }
  return null;
}

function extractSlugFromPage() {
  return parseGameUrl();
}

function findGameCards() {
  const cards = new Set();
  const links = document.querySelectorAll('a[href*="/sports/mlb/mlb-"]');

  for (const link of links) {
    const href = link.href || link.getAttribute("href") || "";
    const m = href.match(/mlb-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}/);
    if (!m) continue;

    let card = link.parentElement;
    for (let i = 0; i < 18 && card; i++) {
      const text = card.textContent || "";
      if (text.includes("Vol") && text.length < 8000) {
        cards.add(card);
        break;
      }
      card = card.parentElement;
    }
  }

  return [...cards];
}

function findChartsInElement(container) {
  const roots = new Set();

  for (const plotRect of container.querySelectorAll("rect")) {
    if (!isGraphPlotRect(plotRect)) continue;
    const root = findChartRootFromPlotRect(plotRect);
    if (root && container.contains(root)) {
      registerChartRoot(root, plotRect);
      roots.add(root);
    }
  }

  if (roots.size === 0) {
    for (const canvas of container.querySelectorAll("canvas")) {
      let node = canvas.parentElement;
      for (let i = 0; i < 12 && node; i++) {
        if (hasChartSignals(node) && container.contains(node)) {
          roots.add(node);
          break;
        }
        node = node.parentElement;
      }
    }
  }

  return [...roots];
}

function getPageType() {
  if (location.pathname.match(/\/sports\/mlb\/mlb-/)) return "game";
  if (location.pathname.includes("/sports/mlb/games")) return "list";
  return "other";
}

function cssColorToHex(color) {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    return c.slice(0, 7);
  }
  const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return `#${[+m[1], +m[2], +m[3]]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function isNeutralChartColor(color) {
  const hex = cssColorToHex(color);
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return sat < 0.12 || lum > 0.9 || lum < 0.07;
}

function getReadableColor(el) {
  let node = el;
  for (let i = 0; i < 5 && node; i++) {
    const hex = cssColorToHex(getComputedStyle(node).color);
    if (hex && !isNeutralChartColor(hex)) return hex;
    node = node.parentElement;
  }
  return null;
}

function textMatchesTeam(text, name, abbr) {
  const lower = text.toLowerCase();
  const team = (name || "").toLowerCase();
  if (team && lower.includes(team)) return true;
  if (abbr && new RegExp(`\\b${abbr}\\b`, "i").test(text)) return true;
  const short = team.split(" ").pop();
  return short && short.length > 4 && lower.includes(short);
}

function pickBestColorCandidate(list) {
  if (!list.length) return null;
  return list.sort((a, b) => {
    if (a.hasPercent !== b.hasPercent) return a.hasPercent ? -1 : 1;
    if (a.depth !== b.depth) return b.depth - a.depth;
    return a.len - b.len;
  })[0].color;
}

function findTeamLabelColors(container, game) {
  const awayName = TEAM_NAMES[game.away.abbr] || game.away.name || "";
  const homeName = TEAM_NAMES[game.home.abbr] || game.home.name || "";
  const awayAbbr = game.away.abbr.toUpperCase();
  const homeAbbr = game.home.abbr.toUpperCase();
  const awayCandidates = [];
  const homeCandidates = [];

  for (const el of container.querySelectorAll("span, p, div, text, tspan")) {
    const text = el.textContent?.trim() || "";
    if (!text || text.length > 90) continue;

    const awayHit = textMatchesTeam(text, awayName, awayAbbr);
    const homeHit = textMatchesTeam(text, homeName, homeAbbr);
    if (!awayHit && !homeHit) continue;
    if (awayHit && homeHit) continue;

    const color = getReadableColor(el);
    if (!color) continue;

    const entry = {
      color,
      hasPercent: /\d+\.?\d*\s*%/.test(text),
      depth: el.querySelector("*") ? 0 : 1,
      len: text.length,
    };

    if (awayHit) awayCandidates.push(entry);
    if (homeHit) homeCandidates.push(entry);
  }

  return {
    away: pickBestColorCandidate(awayCandidates),
    home: pickBestColorCandidate(homeCandidates),
  };
}

function findSvgLineColors(chartRoot) {
  const counts = new Map();
  const svgs = new Set();
  let node = chartRoot;

  for (let i = 0; i < 6 && node; i++) {
    node.querySelectorAll("svg").forEach((svg) => svgs.add(svg));
    node = node.parentElement;
  }

  for (const svg of svgs) {
    for (const el of svg.querySelectorAll("path, line, polyline")) {
      const stroke = el.getAttribute("stroke") || getComputedStyle(el).stroke;
      const width = parseFloat(el.getAttribute("stroke-width") || "0");
      if (!stroke || stroke === "none" || width < 1.2) continue;
      const hex = cssColorToHex(stroke);
      if (!hex || isNeutralChartColor(hex)) continue;
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);
}

function mapColorsByHorizontalPosition(container, game, palette) {
  const awayName = TEAM_NAMES[game.away.abbr] || game.away.name || "";
  const homeName = TEAM_NAMES[game.home.abbr] || game.home.name || "";
  const hits = [];

  for (const el of container.querySelectorAll("span, p, div")) {
    const text = el.textContent?.trim() || "";
    if (!text || text.length > 90) continue;

    const awayHit = textMatchesTeam(text, awayName, game.away.abbr.toUpperCase());
    const homeHit = textMatchesTeam(text, homeName, game.home.abbr.toUpperCase());
    if (!awayHit && !homeHit) continue;

    const color = getReadableColor(el);
    const rect = el.getBoundingClientRect();
    if (!color && rect.width < 2) continue;

    hits.push({
      side: awayHit ? "away" : "home",
      x: rect.left + rect.width / 2,
      color,
    });
  }

  if (!hits.length || palette.length < 2) return {};

  hits.sort((a, b) => a.x - b.x);
  const left = hits[0];
  const right = hits[hits.length - 1];
  const leftColor = left.color || palette[0];
  const rightColor = right.color || palette[palette.length - 1];

  if (left.side === right.side) return { [left.side]: leftColor };

  return {
    [left.side]: leftColor,
    [right.side]: rightColor,
  };
}

/** Read Polymarket chart line colors so markers/table match the graph */
function extractChartTeamColors(chartRoot, game) {
  let container = chartRoot;
  for (let i = 0; i < 5 && container.parentElement; i++) {
    container = container.parentElement;
  }

  const labels = findTeamLabelColors(container, game);
  const strokes = findSvgLineColors(chartRoot);
  const result = { away: labels.away, home: labels.home };

  if (!result.away || !result.home) {
    const pos = mapColorsByHorizontalPosition(container, game, strokes);
    result.away = result.away || pos.away;
    result.home = result.home || pos.home;
  }

  const unused = strokes.filter((c) => c !== result.away && c !== result.home);
  if (!result.away && unused.length) result.away = unused[0];
  if (!result.home && unused.length) {
    result.home = unused.find((c) => c !== result.away) || unused[0];
  }

  if (strokes.length >= 2 && (!result.away || !result.home)) {
    if (!result.away) result.away = strokes[0];
    if (!result.home) result.home = strokes.find((c) => c !== result.away) || strokes[1];
  }

  return {
    away: result.away || teamUIColor(game.away.abbr),
    home: result.home || teamUIColor(game.home.abbr),
  };
}

function isOverlayAlive(chartRoot) {
  return isChartAttached(chartRoot);
}

window.PolyScoreChart = {
  CHART_MARKERS,
  PROCESSED_ATTR,
  findChartRoots,
  findChartsInElement,
  getCanvas,
  getPlotArea,
  getPlotRect,
  detectChartType,
  extractSlugFromCard,
  extractSlugFromPage,
  findGameCards,
  getPageType,
  isChartContainer,
  isOverlayAlive,
  invalidateChartCache,
  extractChartTeamColors,
};

Object.assign(window, {
  findChartRoots,
  findChartsInElement,
  getCanvas,
  getPlotArea,
  getPlotRect,
  detectChartType,
  extractSlugFromCard,
  extractSlugFromPage,
  findGameCards,
  getPageType,
  isChartContainer,
  isChartAttached,
  isOverlayAlive,
  invalidateChartCache,
  extractChartTeamColors,
  PROCESSED_ATTR,
});
