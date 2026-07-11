/**
 * Poly Score — lightweight scanning; relayout markers on timeframe changes
 */
(function init() {
  const pending = new Set();
  const timelineCache = new Map();
  let lastPath = "";
  let scanRunning = false;

  const TIMEFRAMES = new Set(["1H", "6H", "1D", "1W", "1M", "ALL"]);

  async function getTimeline(slug) {
    const key = slugKeyFrom(slug);
    if (timelineCache.has(key)) return timelineCache.get(key);
    const t = await getGameTimeline(slug.away, slug.home, slug.date);
    if (t) timelineCache.set(key, t);
    return t;
  }

  async function processChart(chartRoot, slug, timeline, options = {}) {
    if (!slug || !timeline || isChartAttached(chartRoot)) return;

    const key = `${slugKeyFrom(slug)}-${chartFingerprint(chartRoot)}`;
    if (pending.has(key)) return;
    pending.add(key);

    try {
      await attachToChart(chartRoot, timeline, { ...options, slug });
    } catch (err) {
      console.warn("[Poly Score]", err);
    } finally {
      pending.delete(key);
    }
  }

  async function scanGamePage() {
    const slug = extractSlugFromPage();
    if (!slug) return;

    const timeline = await getTimeline(slug);
    if (!timeline) return;

    const slugKey = slugKeyFrom(slug);
    const charts = findChartRoots();
    if (!charts.length) return;

    const unattached = charts.filter((c) => !isChartAttached(c));
    if (!unattached.length) return;

    const primary = pickPrimaryChart(charts);
    const hasPanel = Boolean(
      document.querySelector(`.poly-score-root[data-slug-key="${slugKey}"]`)
    );

    for (const chart of unattached) {
      await processChart(chart, slug, timeline, {
        slug,
        slugKey,
        showPanel: chart === primary && !hasPanel,
      });
    }
  }

  async function scanListPage() {
    for (const card of findGameCards()) {
      const slug = extractSlugFromCard(card);
      if (!slug) continue;

      const timeline = await getTimeline(slug);
      if (!timeline) continue;

      const slugKey = slugKeyFrom(slug);
      const charts = findChartsInElement(card).filter((c) => !isChartAttached(c));
      if (!charts.length) continue;

      const primary = pickPrimaryChart(charts);
      await processChart(primary, slug, timeline, {
        slug,
        slugKey,
        showPanel: true,
        compact: true,
      });
    }
  }

  async function scan() {
    if (scanRunning) return;
    scanRunning = true;
    try {
      const pageType = getPageType();
      if (pageType === "game") await scanGamePage();
      else if (pageType === "list") await scanListPage();
    } finally {
      scanRunning = false;
      relayoutMarkers();
    }
  }

  let debounceTimer;
  function scheduleScan(delay = 1500) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, delay);
  }

  function relayoutMarkers() {
    layoutAllMarkers?.(true);
    setTimeout(() => layoutAllMarkers?.(true), 400);
    setTimeout(() => layoutAllMarkers?.(true), 1200);
    setTimeout(() => layoutAllMarkers?.(true), 2200);
  }

  function isTimeframeButton(el) {
    if (!el) return false;
    const text = (el.textContent || "").trim().toUpperCase();
    if (TIMEFRAMES.has(text)) return true;
    for (const child of el.querySelectorAll?.("span, div") || []) {
      const t = (child.textContent || "").trim().toUpperCase();
      if (TIMEFRAMES.has(t)) return true;
    }
    return false;
  }

  function onNavigation() {
    const path = location.pathname;
    if (path !== lastPath) {
      lastPath = path;
      timelineCache.clear();
      cleanupOrphans();
      invalidateChartCache();
    }
    scheduleScan(1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onNavigation);
  } else {
    onNavigation();
  }

  setTimeout(scan, 2000);

  document.addEventListener(
    "click",
    (e) => {
      if (getPageType() !== "game") return;
      const el = e.target.closest("button, [role='button'], summary, h3, h4");
      if (!el) return;
      const text = (el.textContent || "").trim();

      if (isTimeframeButton(el)) {
        relayoutMarkers();
        return;
      }

      if (/Spread|Total|Moneyline/i.test(text)) {
        invalidateChartCache();
        scheduleScan(1200);
        relayoutMarkers();
      }
    },
    { passive: true }
  );

  window.addEventListener("popstate", onNavigation);

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    onNavigation();
  };
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    onNavigation();
  };
})();
