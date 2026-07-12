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

  async function processChart(target, slug, timeline, options = {}) {
    const { root, plot, anchor, sectionType, section } = target;
    const chartType = sectionType || "main";
    const slugKey = options.slugKey || slugKeyFrom(slug);

    if (!slug || !timeline || !plot) return;
    if (isPlotAttached(plot, chartType)) return;

    const key = `${slugKey}-${chartType}`;
    if (pending.has(key)) return;
    pending.add(key);

    try {
      await attachToChart(root, timeline, {
        ...options,
        slug,
        slugKey,
        plot,
        anchor,
        section,
        sectionType: chartType,
        showPanel: options.showPanel !== false,
      });
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
    dedupePagePanels(slugKey);

    const targets = findChartTargets();
    if (!targets.length) return;

    for (const target of targets) {
      const chartType = target.sectionType || "main";
      if (isPlotAttached(target.plot, chartType)) continue;

      await processChart(target, slug, timeline, {
        slug,
        slugKey,
        showPanel: !sectionHasPanel(slugKey, chartType),
      });
    }

    dedupePagePanels(slugKey);
    syncPanelVisibility?.();
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
      const plot = getPlotArea(primary);
      if (!plot || isPlotAttached(plot)) continue;

      await processChart(
        { root: primary, plot, anchor: primary, sectionType: "main" },
        slug,
        timeline,
        {
          slug,
          slugKey,
          showPanel: true,
          compact: true,
        }
      );
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

  function scheduleScanBurst(delays = [600, 1800]) {
    invalidateChartCache();
    for (const delay of delays) {
      setTimeout(scan, delay);
    }
  }

  function relayoutMarkers() {
    relayoutAllMarkers?.(true);
    setTimeout(() => relayoutAllMarkers?.(true), 400);
    setTimeout(() => relayoutAllMarkers?.(true), 1200);
    setTimeout(() => relayoutAllMarkers?.(true), 2200);
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

  function isChartRevealClick(el) {
    if (!el) return false;
    const text = (el.textContent || "").trim();
    if (!text || text.length > 48) return false;
    if (/^Graph$/i.test(text)) return true;
    if (/^(Spreads?|Totals?|Moneyline)$/i.test(text)) return true;
    if (/^(Spreads?|Totals?|Moneyline)\b/i.test(text) && /Vol/i.test(text)) {
      return true;
    }
    if (/^\d+(\.\d+)?$/.test(text)) return true;
    return false;
  }

  function clickNearMarketSection(el) {
    let node = el;
    for (let i = 0; i < 10 && node; i++) {
      const sample = (node.textContent || "").slice(0, 400);
      if (sample.length > 2500) {
        node = node.parentElement;
        continue;
      }
      if (
        (/^Spreads?\b/i.test(sample) ||
          /^Totals?\b/i.test(sample) ||
          /^Moneyline\b/i.test(sample)) &&
        /Vol/i.test(sample)
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function onNavigation() {
    const path = location.pathname;
    if (path !== lastPath) {
      lastPath = path;
      timelineCache.clear();
      cleanupOrphans();
      resetPagePanels?.();
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

  setInterval(() => {
    if (getPageType() !== "game") return;
    syncPanelVisibility?.();
    if (scanRunning) return;
    invalidateChartCache();
    const targets = findChartTargets();
    if (
      targets.some((t) => {
        const type =
          t.sectionType || detectChartTypeFromPlot(t.plot) || "main";
        return t.plot?.isConnected && !isPlotAttached(t.plot, type);
      })
    ) {
      scan();
    }
  }, 3500);

  document.addEventListener(
    "click",
    (e) => {
      if (getPageType() !== "game") return;
      const el = e.target.closest(
        "button, [role='button'], summary, h3, h4, a, span"
      );
      if (!el) return;
      if (el.tagName === "SPAN" && (el.textContent || "").trim().length > 16) {
        return;
      }

      if (isTimeframeButton(el)) {
        relayoutMarkers();
        return;
      }

      if (isChartRevealClick(el) || clickNearMarketSection(el)) {
        syncPanelVisibility?.();
        scheduleScanBurst();
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
