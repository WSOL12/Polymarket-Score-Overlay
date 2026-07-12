/**
 * Detect Polymarket charts via SVG plot rects + page context
 */
const CHART_MARKERS = ["1H", "6H", "1D", "1W", "1M", "ALL"];
const PROCESSED_ATTR = "data-poly-score-id";

const plotByRoot = new WeakMap();
const chartRootsCache = { roots: null, targets: null };

function hasChartSignals(el, minMarkers = 2) {
  if (!el) return false;
  const found = new Set();
  for (const node of el.querySelectorAll("button, [role='button'], span, div, a")) {
    const t = node.textContent?.trim();
    if (!t || t.length > 6) continue;
    if (CHART_MARKERS.includes(t)) {
      found.add(t);
      if (found.size >= minMarkers) return true;
    }
  }
  return minMarkers <= 1 && found.size >= 1;
}

function isLikelyChartCanvas(canvas) {
  if (!canvas?.isConnected || !isVisiblePlot(canvas)) return false;

  let node = canvas.parentElement;
  for (let i = 0; i < 12 && node; i++) {
    if (hasChartSignals(node, 1)) return true;
    const sample = (node.textContent || "").slice(0, 600);
    if (/Graph/i.test(sample) && /(1H|6H|1D|1W|1M|ALL)/.test(sample)) return true;
    node = node.parentElement;
  }

  const r = canvas.getBoundingClientRect();
  return r.width >= 160 && r.height >= 45;
}

function findChartRootFromCanvas(canvas) {
  let node = canvas.parentElement;
  for (let i = 0; i < 14 && node; i++) {
    if (hasChartSignals(node, 1)) return node;
    const sample = (node.textContent || "").slice(0, 400);
    if (/Graph/i.test(sample) && /Vol/i.test(sample)) return node;
    node = node.parentElement;
  }
  return canvas.parentElement || canvas;
}

function collectVisibleChartSurfaces() {
  const seen = new Set();
  const surfaces = [];

  const add = (plot, root) => {
    if (!plot || !root || seen.has(plot)) return;
    if (!isVisiblePlot(plot)) return;
    seen.add(plot);
    registerChartRoot(root, plot);
    surfaces.push({
      plot,
      root,
      anchor: findPanelAnchor(plot, root),
    });
  };

  for (const rect of document.querySelectorAll("svg rect, rect")) {
    if (!isGraphPlotRect(rect)) continue;
    add(rect, findChartRootFromPlotRect(rect));
  }

  for (const canvas of document.querySelectorAll("canvas")) {
    if (!isLikelyChartCanvas(canvas)) continue;
    add(canvas, findChartRootFromCanvas(canvas));
  }

  return surfaces;
}

function isTransparentPlotFill(el) {
  const fill = (el.getAttribute("fill") || "").toLowerCase();
  return fill === "transparent" || fill === "none" || fill === "";
}

function isGraphPlotRect(el) {
  if (!el || el.tagName?.toLowerCase() !== "rect") return false;
  if (!isTransparentPlotFill(el)) return false;

  const x = parseFloat(el.getAttribute("x") || "0");
  const y = parseFloat(el.getAttribute("y") || "0");
  const w = parseFloat(el.getAttribute("width") || "0");
  const h = parseFloat(el.getAttribute("height") || "0");

  if (x === 0 && y === 0 && w >= 280 && h >= 70 && h <= 420) return true;

  const r = el.getBoundingClientRect();
  return r.width >= 200 && r.height >= 50 && r.height <= 480;
}

function isVisiblePlot(el) {
  if (!el?.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 120 && r.height >= 35;
}

function findAllPlotRects() {
  const rects = new Set();
  for (const el of document.querySelectorAll("svg rect, rect")) {
    if (isGraphPlotRect(el)) rects.add(el);
  }
  return [...rects];
}

function matchSectionTitle(text) {
  const t = (text || "").trim();
  if (!t || t.length > 64) return null;
  if (/^Moneyline$/i.test(t)) return "moneyline";
  if (/^Spreads?$/i.test(t)) return "spread";
  if (/^Totals?$/i.test(t)) return "total";
  if (/^Moneyline\b/i.test(t) && /Vol/i.test(t)) return "moneyline";
  if (/^Spreads?\b/i.test(t) && /Vol/i.test(t)) return "spread";
  if (/^Totals?\b/i.test(t) && /Vol/i.test(t)) return "total";
  return null;
}

function findSectionRoot(headerEl, type) {
  let section = headerEl;
  for (let i = 0; i < 14 && section.parentElement; i++) {
    section = section.parentElement;
    const sample = (section.textContent || "").slice(0, 500);
    if (sample.length > 3000) continue;

    const title =
      type === "moneyline"
        ? /^Moneyline\b/i
        : type === "spread"
          ? /^Spreads?\b/i
          : /^Totals?\b/i;

    if (title.test(sample) && /Vol/i.test(sample)) {
      const hasSibling =
        (type !== "moneyline" && /^Moneyline\b/i.test(sample)) ||
        (type !== "spread" && /^Spreads?\b/i.test(sample)) ||
        (type !== "total" && /^Totals?\b/i.test(sample));
      if (!hasSibling || sample.length < 1200) return section;
    }
  }
  return headerEl.parentElement || headerEl;
}

function findSectionHeaders() {
  const candidates = new Map();

  for (const el of document.querySelectorAll(
    "h1, h2, h3, h4, button, span, p, div"
  )) {
    if (el.children.length > 5) continue;

    const type = matchSectionTitle(el.textContent);
    if (!type) continue;

    const textLen = (el.textContent || "").trim().length;
    const prev = candidates.get(type);
    if (!prev || textLen < prev.textLen) {
      candidates.set(type, { el, type, textLen });
    }
  }

  const headers = [];
  for (const { el, type } of candidates.values()) {
    const section = findSectionRoot(el, type);
    headers.push({ el, type, section });
  }

  return headers;
}

function findNearestPlot(plots, headerEl) {
  if (!plots.length) return null;
  if (!headerEl) return plots[0];

  const headerY = headerEl.getBoundingClientRect().top;
  return plots.sort((a, b) => {
    const da = Math.abs(a.getBoundingClientRect().top - headerY);
    const db = Math.abs(b.getBoundingClientRect().top - headerY);
    return da - db;
  })[0];
}

function findPlotInSection(section, headerEl) {
  if (!section?.isConnected) return null;

  const plotRects = [...section.querySelectorAll("rect")].filter(
    (r) => isGraphPlotRect(r) && isVisiblePlot(r)
  );
  const plotRect = findNearestPlot(plotRects, headerEl);
  if (plotRect) {
    const root = findChartRootFromPlotRect(plotRect);
    return {
      root,
      plot: plotRect,
      anchor: findPanelAnchor(plotRect, root),
    };
  }

  const canvases = [...section.querySelectorAll("canvas")].filter(isVisiblePlot);
  const canvas = findNearestPlot(canvases, headerEl);
  if (canvas) {
    let container = canvas.parentElement;
    for (let i = 0; i < 10 && container && section.contains(container); i++) {
      if (hasChartSignals(container)) {
        return {
          root: container,
          plot: canvas,
          anchor: findPanelAnchor(canvas, container),
        };
      }
      container = container.parentElement;
    }
  }

  return null;
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

function findPanelAnchor(plotRect, chartRoot) {
  let node = plotRect?.closest?.("svg")?.parentElement || chartRoot;
  for (let i = 0; i < 10 && node; i++) {
    if (hasChartSignals(node)) return node;
    node = node.parentElement;
  }
  return chartRoot || plotRect?.parentElement;
}

function findSectionForPlot(plot) {
  if (!plot?.isConnected) return null;
  const type = detectChartTypeFromPlot(plot);
  for (const { type: t, section } of findSectionHeaders()) {
    if (t === type && section?.contains(plot)) return section;
  }
  return null;
}

function findPanelInsertAfter(anchor, section) {
  if (section?.isConnected) return section;

  let node = anchor;
  for (let i = 0; i < 14 && node?.parentElement; i++) {
    const parent = node.parentElement;
    const style = getComputedStyle(parent);
    const clips =
      style.overflow === "hidden" ||
      style.overflowY === "hidden" ||
      style.overflow === "clip" ||
      style.overflowY === "clip";
    if (clips) return parent;
    node = parent;
  }
  return anchor;
}

function plotStableKey(plot, sectionType = null, slugKey = null) {
  if (!plot) return null;
  const type = sectionType || detectChartTypeFromPlot(plot);
  const w =
    plot.getAttribute("width") ||
    String(Math.round(plot.getBoundingClientRect().width));
  const h =
    plot.getAttribute("height") ||
    String(Math.round(plot.getBoundingClientRect().height));
  const sizeKey = `${type}-${w}x${h}`;
  return slugKey ? `${slugKey}-${sizeKey}` : sizeKey;
}

function detectChartTypeFromPlot(plot) {
  if (!plot?.isConnected) return "main";

  const plotTop = plot.getBoundingClientRect().top;
  let bestType = null;
  let bestDist = Infinity;

  for (const el of document.querySelectorAll(
    "h1, h2, h3, h4, button, span, p, div"
  )) {
    if (el.children.length > 5) continue;
    const type = matchSectionTitle(el.textContent);
    if (!type) continue;

    const r = el.getBoundingClientRect();
    if (r.height < 1) continue;
    const dist = plotTop - r.bottom;
    if (dist >= -40 && dist < bestDist) {
      bestDist = dist;
      bestType = type;
    }
  }

  return bestType || "main";
}

function plotPositionKey(plot) {
  return plotStableKey(plot);
}

function detectChartType(chartRoot, hint) {
  if (hint) return hint;

  let node = chartRoot;
  for (let i = 0; i < 12 && node; i++) {
    for (const el of node.querySelectorAll?.(
      "h1, h2, h3, h4, button, span, p, div"
    ) || []) {
      if (el.children.length > 4) continue;
      const type = matchSectionTitle(el.textContent);
      if (type) return type;
    }

    const own = matchSectionTitle((node.textContent || "").slice(0, 80));
    if (own) return own;
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
  chartRootsCache.targets = null;
}

function findChartTargets() {
  const bySection = new Map();

  for (const { type, section, el } of findSectionHeaders()) {
    if (bySection.has(type)) continue;

    const chart = findPlotInSection(section, el);
    if (!chart) continue;

    registerChartRoot(chart.root, chart.plot);
    bySection.set(type, {
      root: chart.root,
      plot: chart.plot,
      anchor: chart.anchor,
      section,
      sectionType: type,
    });
  }

  for (const plotRect of findAllPlotRects()) {
    if (!isVisiblePlot(plotRect)) continue;

    const inferred = detectChartTypeFromPlot(plotRect);
    if (bySection.has(inferred)) continue;

    const root = findChartRootFromPlotRect(plotRect);
    if (!root) continue;

    registerChartRoot(root, plotRect);
    bySection.set(inferred, {
      root,
      plot: plotRect,
      anchor: findPanelAnchor(plotRect, root),
      section: findSectionForPlot(plotRect),
      sectionType: inferred,
    });
  }

  if (!bySection.size) {
    for (const canvas of document.querySelectorAll("canvas")) {
      if (!isVisiblePlot(canvas)) continue;

      const inferred = detectChartTypeFromPlot(canvas);
      if (bySection.has(inferred)) continue;

      let container = canvas.parentElement;
      for (let i = 0; i < 12 && container; i++) {
        if (hasChartSignals(container)) {
          registerChartRoot(container, canvas);
          bySection.set(inferred, {
            root: container,
            plot: canvas,
            anchor: findPanelAnchor(canvas, container),
            section: findSectionForPlot(canvas),
            sectionType: inferred,
          });
          break;
        }
        container = container.parentElement;
      }
    }
  }

  const targets = [...bySection.values()];
  chartRootsCache.targets = targets;
  chartRootsCache.roots = targets.map((t) => t.root);
  return targets;
}

function findChartRoots() {
  return findChartTargets().map((t) => t.root);
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
  const rect = getPlotRect(chartRoot);
  const canvas = getCanvas(chartRoot);
  if (!canvas?.isConnected) return rect;
  if (!rect?.isConnected) return canvas;

  const rRect = rect.getBoundingClientRect();
  const rCanvas = canvas.getBoundingClientRect();
  return rCanvas.width * rCanvas.height > rRect.width * rRect.height
    ? canvas
    : rect;
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
  return findListGameEntries().map((entry) => entry.headerCard);
}

function findAccordionPanel(fullSlug, headerCard) {
  let panel = document.getElementById(`sports-accordion-item-${fullSlug}`);
  if (panel) return panel;

  let node = headerCard;
  for (let i = 0; i < 12 && node; i++) {
    panel = node.querySelector?.(`#sports-accordion-item-${fullSlug}`);
    if (panel) return panel;
    if (node.nextElementSibling?.id === `sports-accordion-item-${fullSlug}`) {
      return node.nextElementSibling;
    }
    node = node.parentElement;
  }

  return null;
}

function isListAccordionOpen(panel, headerCard) {
  if (!panel?.isConnected) return false;
  if (panel.getAttribute("data-state") === "closed") return false;
  if (panel.hasAttribute("hidden")) return false;
  const r = panel.getBoundingClientRect();
  return r.height > 40 && r.width > 80;
}

function findListGameEntries() {
  const bySlug = new Map();

  for (const link of document.querySelectorAll('a[href*="/sports/mlb/mlb-"]')) {
    const href = link.href || link.getAttribute("href") || "";
    const m = href.match(/(mlb-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2})/);
    if (!m || bySlug.has(m[1])) continue;

    const slug = parseGameSlug(m[1]);
    if (!slug) continue;

    let headerCard = link.closest('[class*="rounded-xl"]') || link.parentElement;
    for (let i = 0; i < 14 && headerCard; i++) {
      const links = headerCard.querySelectorAll('a[href*="/sports/mlb/mlb-"]');
      const text = headerCard.textContent || "";
      if (text.length > 5000) {
        headerCard = headerCard.parentElement;
        continue;
      }
      if (links.length === 1 && (text.includes("Vol") || /\bFINAL\b/i.test(text))) {
        break;
      }
      headerCard = headerCard.parentElement;
    }

    const card = headerCard || link.parentElement;
    bySlug.set(m[1], {
      slug,
      fullSlug: m[1],
      headerCard: card,
      panel: findAccordionPanel(m[1], card),
    });
  }

  return [...bySlug.values()];
}

function findChartNearEntry(entry) {
  const header = entry?.headerCard;
  if (!header?.isConnected) return null;

  const headerRect = header.getBoundingClientRect();
  if (headerRect.height < 1) return null;

  const centerX = headerRect.left + headerRect.width / 2;
  const minY = headerRect.top - 30;
  const maxY = headerRect.bottom + 1400;

  let best = null;
  let bestScore = Infinity;

  for (const surface of collectVisibleChartSurfaces()) {
    const r = surface.plot.getBoundingClientRect();
    if (r.bottom < minY || r.top > maxY) continue;

    const plotCenterX = r.left + r.width / 2;
    const dx = Math.abs(plotCenterX - centerX);
    const dy =
      r.top >= headerRect.top
        ? r.top - headerRect.top
        : headerRect.bottom - r.bottom + 200;
    const score = dy + dx * 0.35;

    if (score < bestScore) {
      bestScore = score;
      best = surface;
    }
  }

  if (!best || bestScore > 1100) return null;
  return best;
}

function findListChartInContainer(container) {
  const charts = findChartsInElement(container);
  if (!charts.length) return null;

  const root = charts.sort((a, b) => {
    const pa = getPlotArea(a);
    const pb = getPlotArea(b);
    const ra = pa?.getBoundingClientRect() || { width: 0, height: 0 };
    const rb = pb?.getBoundingClientRect() || { width: 0, height: 0 };
    return rb.width * rb.height - ra.width * ra.height;
  })[0];
  const plot = getPlotArea(root);
  if (!plot || !isVisiblePlot(plot)) return null;

  return { root, plot, anchor: findPanelAnchor(plot, root) };
}

function getListEntryScope(entry) {
  const scopes = [];
  if (entry?.headerCard?.isConnected) scopes.push(entry.headerCard);
  if (entry?.panel?.isConnected) scopes.push(entry.panel);
  const sib = entry?.headerCard?.nextElementSibling;
  if (sib?.isConnected) scopes.push(sib);
  return scopes;
}

function entryHasGraphTab(entry) {
  for (const scope of getListEntryScope(entry)) {
    const text = scope.textContent || "";
    if (/Graph/i.test(text) && /(1H|6H|1D|1W|1M|ALL)/i.test(text)) return true;
  }
  return false;
}

function findListChartInEntry(entry) {
  if (!entry?.headerCard?.isConnected) return null;
  if (!entryHasGraphTab(entry)) return null;

  for (const container of getListEntryScope(entry)) {
    const chart = findListChartInContainer(container);
    if (chart && isPlotAlignedWithEntry(chart.plot, entry)) {
      return chart;
    }
  }

  return null;
}

function isListEntryExpanded(entry) {
  const chart = findListChartInEntry(entry);
  if (!chart?.plot?.isConnected) return false;
  const r = chart.plot.getBoundingClientRect();
  return r.width >= 80 && r.height >= 35;
}

function findActiveListGame() {
  let best = null;
  let bestDist = Infinity;

  for (const entry of findListGameEntries()) {
    if (!entryHasGraphTab(entry)) continue;

    const chart = findListChartInEntry(entry);
    if (!chart?.plot?.isConnected || !isPlotInViewport(chart.plot)) continue;

    const hr = entry.headerCard.getBoundingClientRect();
    const pr = chart.plot.getBoundingClientRect();
    if (pr.top < hr.top - 50 || pr.top > hr.bottom + 900) continue;

    const dist = Math.abs(pr.top - hr.bottom);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }

  return best;
}

function plotIsInEntry(entry, plot) {
  if (!plot?.isConnected || !entry?.headerCard?.isConnected) return false;

  for (const scope of getListEntryScope(entry)) {
    if (scope.contains(plot)) return true;
  }

  return isPlotAlignedWithEntry(plot, entry);
}

function findListChartForGame(entry) {
  const chart = findListChartInEntry(entry);
  if (!chart) return null;
  return {
    ...chart,
    card: entry.headerCard,
    panel: entry.panel,
    entry,
  };
}

function isPlotInViewport(plot) {
  if (!plot?.isConnected) return false;
  const r = plot.getBoundingClientRect();
  if (r.width < 80 || r.height < 35) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}

function isPlotAlignedWithEntry(plot, entry) {
  if (!plot?.isConnected || !entry?.headerCard?.isConnected) return false;
  const pr = plot.getBoundingClientRect();
  const hr = entry.headerCard.getBoundingClientRect();
  const dx = Math.abs(pr.left + pr.width / 2 - (hr.left + hr.width / 2));
  if (dx > Math.max(hr.width * 0.85, 220)) return false;
  if (pr.top < hr.top - 100) return false;
  if (pr.top > hr.bottom + 1400) return false;
  return true;
}

function isListGameVisible(plot, chartRoot, entry) {
  if (!plot?.isConnected || !entry?.headerCard?.isConnected) return false;
  if (!isListEntryExpanded(entry)) return false;
  if (!plotIsInEntry(entry, plot)) return false;
  if (!isPlotInViewport(plot)) return false;

  const r = plot.getBoundingClientRect();
  if (r.width < 80 || r.height < 35) return false;

  let node = plot;
  for (let i = 0; i < 20 && node; i++) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    node = node.parentElement;
  }

  return true;
}

function findChartsInElement(container) {
  const roots = new Set();

  for (const plotRect of container.querySelectorAll("rect")) {
    if (!isGraphPlotRect(plotRect) || !isVisiblePlot(plotRect)) continue;
    const root = findChartRootFromPlotRect(plotRect);
    if (root && container.contains(plotRect)) {
      registerChartRoot(root, plotRect);
      roots.add(root);
    }
  }

  if (roots.size === 0) {
    for (const canvas of container.querySelectorAll("canvas")) {
      const r = canvas.getBoundingClientRect();
      const largeEnough = r.width >= 200 && r.height >= 70;
      if (!isLikelyChartCanvas(canvas) && !largeEnough) continue;
      const root = findChartRootFromCanvas(canvas);
      if (root) {
        registerChartRoot(root, canvas);
        roots.add(root);
      }
    }
  }

  return [...roots];
}

function findListChartInCard(card) {
  const chart = findListChartInContainer(card);
  if (!chart) return null;
  return { ...chart, card };
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

function findOverUnderLabelColors(container) {
  const over = [];
  const under = [];

  for (const el of container.querySelectorAll("span, p, div, text, tspan")) {
    const text = el.textContent?.trim() || "";
    if (!text || text.length > 80) continue;

    const color = getReadableColor(el);
    if (!color) continue;

    const entry = {
      color,
      hasPercent: /\d+\.?\d*\s*%/.test(text),
      len: text.length,
    };

    if (/\bOver\b/i.test(text)) over.push(entry);
    else if (/\bUnder\b/i.test(text)) under.push(entry);
  }

  return {
    over: pickBestColorCandidate(over),
    under: pickBestColorCandidate(under),
  };
}

function findSvgLineColorsByPosition(chartRoot) {
  const svgs = new Set();
  let node = chartRoot;
  for (let i = 0; i < 6 && node; i++) {
    node.querySelectorAll("svg").forEach((svg) => svgs.add(svg));
    node = node.parentElement;
  }

  const byColor = new Map();
  for (const svg of svgs) {
    const svgRect = svg.getBoundingClientRect();
    for (const el of svg.querySelectorAll("path, line, polyline")) {
      const stroke = el.getAttribute("stroke") || getComputedStyle(el).stroke;
      const width = parseFloat(el.getAttribute("stroke-width") || "0");
      if (!stroke || stroke === "none" || width < 1.2) continue;
      const hex = cssColorToHex(stroke);
      if (!hex || isNeutralChartColor(hex)) continue;

      const r = el.getBoundingClientRect();
      const y = r.height > 0 ? r.top + r.height / 2 : svgRect.top + svgRect.height / 2;
      const bucket = byColor.get(hex) || { color: hex, ySum: 0, n: 0 };
      bucket.ySum += y;
      bucket.n += 1;
      byColor.set(hex, bucket);
    }
  }

  const ranked = [...byColor.values()]
    .map((b) => ({ color: b.color, y: b.ySum / b.n }))
    .sort((a, b) => a.y - b.y);

  if (ranked.length < 2) return null;
  return { top: ranked[0].color, bottom: ranked[ranked.length - 1].color };
}

/** Read Polymarket chart line colors so markers/table match the graph */
function extractChartTeamColors(chartRoot, game, chartType = "main") {
  let container = chartRoot;
  for (let i = 0; i < 5 && container.parentElement; i++) {
    container = container.parentElement;
  }

  const strokes = findSvgLineColors(chartRoot);
  const byPos = findSvgLineColorsByPosition(chartRoot);

  if (chartType === "total") {
    const ou = findOverUnderLabelColors(container);
    const away = byPos?.top || strokes[0] || ou.over;
    const home =
      byPos?.bottom ||
      strokes.find((c) => c !== away) ||
      strokes[1] ||
      ou.under;
    return {
      away: away || teamUIColor(game.away.abbr),
      home: home || teamUIColor(game.home.abbr),
    };
  }

  const labels = findTeamLabelColors(container, game);
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

function isChartPlotVisible(plot, chartRoot, section = null) {
  if (!plot?.isConnected) return false;

  const r = plot.getBoundingClientRect();
  if (r.width < 80 || r.height < 40) return false;

  if (chartRoot?.isConnected) {
    const cr = chartRoot.getBoundingClientRect();
    if (cr.width < 80 || cr.height < 50) return false;
  }

  // Collapsed accordion: section shrinks to header-only (not scroll position)
  if (section?.isConnected) {
    const sr = section.getBoundingClientRect();
    if (sr.height < 100) return false;
  }

  let node = plot;
  for (let i = 0; i < 25 && node; i++) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (style.maxHeight === "0px" || style.height === "0px") return false;
    node = node.parentElement;
  }

  return true;
}

function isOverlayAlive(chartRoot) {
  return isChartAttached(chartRoot);
}

window.PolyScoreChart = {
  CHART_MARKERS,
  PROCESSED_ATTR,
  findChartRoots,
  findChartTargets,
  plotPositionKey,
  plotStableKey,
  detectChartTypeFromPlot,
  findPanelInsertAfter,
  findSectionForPlot,
  findChartsInElement,
  findListChartInCard,
  findListGameEntries,
  findListChartForGame,
  findChartNearEntry,
  collectVisibleChartSurfaces,
  isListGameVisible,
  isListEntryExpanded,
  entryHasGraphTab,
  findActiveListGame,
  findListChartInEntry,
  plotIsInEntry,
  isListAccordionOpen,
  isPlotInViewport,
  isPlotAlignedWithEntry,
  findAccordionPanel,
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
  isChartPlotVisible,
};

Object.assign(window, {
  findChartRoots,
  findChartTargets,
  plotPositionKey,
  plotStableKey,
  detectChartTypeFromPlot,
  findPanelInsertAfter,
  findSectionForPlot,
  findChartsInElement,
  findListChartInCard,
  findListGameEntries,
  findListChartForGame,
  findChartNearEntry,
  collectVisibleChartSurfaces,
  isListGameVisible,
  isListEntryExpanded,
  entryHasGraphTab,
  findActiveListGame,
  findListChartInEntry,
  plotIsInEntry,
  isListAccordionOpen,
  isPlotInViewport,
  isPlotAlignedWithEntry,
  findAccordionPanel,
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
  isChartPlotVisible,
  PROCESSED_ATTR,
});
