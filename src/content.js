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
    const { root, plot, anchor, sectionType, section, card, listEntry } = target;
    const chartType = sectionType || "main";
    const slugKey = options.slugKey || slugKeyFrom(slug);

    if (!slug || !timeline || !plot) return;
    if (isPlotAttached(plot, chartType, slugKey)) {
      if (listEntry) {
        await attachToChart(root, timeline, {
          ...options,
          slug,
          slugKey,
          plot,
          anchor,
          section,
          card,
          listEntry,
          sectionType: chartType,
          showPanel: options.showPanel !== false,
        });
      }
      return;
    }

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
        card,
        listEntry,
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
      if (isPlotAttached(target.plot, chartType, slugKey)) continue;

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
    beginListPageUpdate?.();
    try {
      const active = maintainListPage?.();
      if (!active) return;

      const chart = findListChartForGame(active);
      if (!chart) return;

      const slugKey = slugKeyFrom(active.slug);
      const timeline = await getTimeline(active.slug);
      if (!timeline) return;

      await processChart(
        {
          root: chart.root,
          plot: chart.plot,
          anchor: chart.anchor,
          sectionType: "main",
          section: active.panel || active.headerCard,
          card: active.headerCard,
          listEntry: active,
        },
        active.slug,
        timeline,
        {
          slug: active.slug,
          slugKey,
          showPanel: true,
          compact: true,
          listEntry: active,
        }
      );
    } finally {
      endListPageUpdate?.();
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
      if (getPageType() === "list") {
        repositionListMarkers?.();
        syncListPanelVisibility?.();
      } else {
        relayoutMarkers();
      }
    }
  }

  let debounceTimer;
  function scheduleScan(delay = 1500) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, delay);
  }

  function scheduleScanBurst(delays = [400, 1200, 2500]) {
    invalidateChartCache();
    for (const delay of delays) {
      setTimeout(scan, delay);
    }
  }

  function detectMarketSectionClick(el) {
    let node = el;
    for (let i = 0; i < 14 && node; i++) {
      const sample = (node.textContent || "").slice(0, 400);
      if (sample.length > 2500) {
        node = node.parentElement;
        continue;
      }
      if (/^Totals?\b/i.test(sample) && /Vol/i.test(sample)) return "total";
      if (/^Spreads?\b/i.test(sample) && /Vol/i.test(sample)) return "spread";
      if (/^Moneyline\b/i.test(sample) && /Vol/i.test(sample)) return "moneyline";
      node = node.parentElement;
    }

    const text = (el.textContent || "").trim();
    if (/^Totals?$/i.test(text)) return "total";
    if (/^Spreads?$/i.test(text)) return "spread";
    if (/^Moneyline$/i.test(text)) return "moneyline";
    return null;
  }

  function isSectionHeaderClick(el) {
    const text = (el.textContent || "").trim();
    if (/^(Spreads?|Totals?|Moneyline)$/i.test(text)) return true;
    return (
      /^(Spreads?|Totals?|Moneyline)\b/i.test(text) &&
      /Vol/i.test(text) &&
      text.length < 48
    );
  }

  function onMarketSectionChange(el) {
    const sectionType = detectMarketSectionClick(el);

    if (isSectionHeaderClick(el)) {
      hideAllPanelsImmediately?.();
    } else if (sectionType) {
      hidePanelsExcept?.(sectionType);
    }

    scheduleVisibilitySync?.();
    scheduleScanBurst();
    relayoutMarkers();
  }

  function isListPageChartClick(el) {
    if (!el) return false;
    const text = (el.textContent || "").trim();
    if (/^Graph$/i.test(text)) return true;
    if (/view finished/i.test(text)) return true;
    if (TIMEFRAMES.has(text.toUpperCase())) return true;
    if (el.closest('a[href*="/sports/mlb/mlb-"]')) return true;
    if (/\bFINAL\b/i.test(text) && text.length < 24) return true;
    return false;
  }

  function clickInsideGameCard(el) {
    if (el.closest('[id^="sports-accordion-item-mlb-"]')) return true;
    let node = el;
    for (let i = 0; i < 16 && node; i++) {
      if (extractSlugFromCard(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isListPageGameHeaderClick(el) {
    if (el.closest('a[href*="/sports/mlb/mlb-"]')) return true;
    const text = (el.textContent || "").trim();
    return /\bFINAL\b/i.test(text) && text.length < 40;
  }

  function onListPageInteraction() {
    invalidateChartCache();
    scheduleScan(350);
  }

  function isListAccordionMutation(m) {
    const t = m.target;
    if (t?.id?.startsWith?.("sports-accordion-item-mlb-")) return true;
    if (t?.closest?.('[id^="sports-accordion-item-mlb-"]')) return true;
    if (
      m.type === "attributes" &&
      (m.attributeName === "data-state" || m.attributeName === "hidden")
    ) {
      return Boolean(t?.closest?.('[id^="sports-accordion-item-mlb-"]'));
    }
    return false;
  }

  function watchListAccordions() {
    if (watchListAccordions._on) return;
    watchListAccordions._on = true;

    let syncTimer = 0;
    const observer = new MutationObserver((mutations) => {
      if (getPageType() !== "list") return;
      if (isListPageBusy?.()) return;
      if (
        mutations.every((m) =>
          m.target?.closest?.(".poly-score-root, .poly-score-markers")
        )
      ) {
        return;
      }
      if (!mutations.some(isListAccordionMutation)) return;

      maintainListPage?.();
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => scheduleScan(400), 150);
    });

    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "hidden"],
      childList: true,
    });
  }

  function relayoutMarkers() {
    if (getPageType() === "list") {
      if (isListPageScrolling?.()) return;
      relayoutAllMarkers?.(false);
      return;
    }
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

  watchListAccordions();

  setTimeout(scan, 2000);

  setInterval(() => {
    const pageType = getPageType();
    if (pageType === "list") {
      if (scanRunning || isListPageBusy?.()) return;
      maintainListPage?.();
      const active = findActiveListGame?.();
      if (!active) return;
      const slugKey = slugKeyFrom(active.slug);
      const existing = findAttachedBySlug?.(slugKey, "main");
      if (existing?.data?.panel?.isConnected && existing?.data?.markers?.isConnected) {
        return;
      }
      scan();
      return;
    }

    if (pageType !== "game") return;
    syncPanelVisibility?.();
    if (scanRunning) return;
    invalidateChartCache();
    const targets = findChartTargets();
    if (
      targets.some((t) => {
        const type =
          t.sectionType || detectChartTypeFromPlot(t.plot) || "main";
        const slug = extractSlugFromPage();
        const slugKey = slug ? slugKeyFrom(slug) : null;
        return (
          t.plot?.isConnected &&
          !isPlotAttached(t.plot, type, slugKey)
        );
      })
    ) {
      scan();
    }
  }, 3500);

  document.addEventListener(
    "click",
    (e) => {
      const pageType = getPageType();

      if (pageType === "list") {
        if (e.target.closest(".poly-score-root, .poly-score-markers")) return;
        const el = e.target.closest(
          "button, [role='button'], a, span, div"
        );
        if (el && (isListPageChartClick(el) || clickInsideGameCard(el))) {
          onListPageInteraction();
        }
        return;
      }

      if (pageType !== "game") return;
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
        onMarketSectionChange(el);
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
