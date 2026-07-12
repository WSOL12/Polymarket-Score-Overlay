/**
 * Score overlay — markers on body (fixed), zero injection into React chart DOM
 */
const OVERLAY_CLASS = "poly-score-root";
const MARKERS_CLASS = "poly-score-markers";
const attached = new Map();
const pagePanels = new Map();
const attachingSections = new Set();

let overlaySeq = 0;
let scrollRaf = 0;

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatScore(away, home) {
  return `${away} – ${home}`;
}

function slugKeyFrom(slug) {
  return `${slug.away}-${slug.home}-${slug.date}`;
}

function chartFingerprint(chartRoot, plot = null, sectionType = null) {
  const area = plot || getPlotArea(chartRoot);
  if (!area) return `chart-${++overlaySeq}`;
  return plotStableKey(area, sectionType || detectChartType(chartRoot, sectionType));
}

function panelKeyFor(slugKey, chartRoot, plot = null, sectionType = null) {
  const type =
    sectionType || detectChartType(chartRoot, sectionType) || "main";
  return `${slugKey}-${type}`;
}

function removePanelsForSection(slugKey, chartType) {
  const panels = [
    ...document.querySelectorAll(
      `.${OVERLAY_CLASS}[data-slug-key="${slugKey}"][data-chart-type="${chartType}"]`
    ),
  ];

  for (let i = 1; i < panels.length; i++) panels[i].remove();

  for (const [key, panel] of pagePanels) {
    if (key === `${slugKey}-${chartType}` && panel && !panel.isConnected) {
      pagePanels.delete(key);
    }
  }

  return panels[0] || null;
}

function dedupePagePanels(slugKey) {
  const keepers = new Map();
  document
    .querySelectorAll(`.${OVERLAY_CLASS}[data-slug-key="${slugKey}"]`)
    .forEach((panel) => {
      const type = panel.dataset.chartType || "main";
      if (!keepers.has(type)) keepers.set(type, panel);
      else panel.remove();
    });
}

function getSectionPanel(slugKey, chartType) {
  return document.querySelector(
    `.${OVERLAY_CLASS}[data-slug-key="${slugKey}"][data-chart-type="${chartType}"]`
  );
}

function placePanel(panel, anchor, section) {
  const insertAfter = findPanelInsertAfter(anchor, section);
  if (!panel || !insertAfter?.isConnected) return;
  if (panel.previousElementSibling === insertAfter) return;
  insertAfter.insertAdjacentElement("afterend", panel);
}

function placeListPanel(panel, anchor, listEntry) {
  if (!panel) return;

  let insertAfter = null;
  const chartRoot = anchor?.closest?.("[class*='chart']") || anchor;

  if (listEntry?.panel?.isConnected && isListAccordionOpen(listEntry.panel, listEntry.headerCard)) {
    insertAfter = listEntry.panel;
  } else if (chartRoot?.isConnected) {
    insertAfter = findPanelInsertAfter(chartRoot, listEntry?.headerCard);
  } else {
    insertAfter = findPanelInsertAfter(anchor, listEntry?.headerCard);
  }

  if (!insertAfter?.isConnected) return;
  if (panel.previousElementSibling === insertAfter) return;
  insertAfter.insertAdjacentElement("afterend", panel);
}

function teamDisplayName(team) {
  return TEAM_NAMES[team.abbr] || team.name || team.abbr.toUpperCase();
}

function updatePanelColors(panel, chartColors, timeline) {
  const { game, events } = timeline;
  const awayColor = chartColors?.away || teamUIColor(game.away.abbr);
  const homeColor = chartColors?.home || teamUIColor(game.home.abbr);

  const teamNames = panel.querySelectorAll(".ps-team-name");
  if (teamNames[0]) teamNames[0].style.setProperty("--team-color", awayColor);
  if (teamNames[1]) teamNames[1].style.setProperty("--team-color", homeColor);

  panel.querySelectorAll(".ps-timeline-row").forEach((row, idx) => {
    const ev = events[idx];
    if (!ev) return;
    const isTop = ev.halfLabel === "Top";
    const pill = row.querySelector(".ps-inning-pill");
    if (pill) pill.setAttribute("style", inningPillStyle(isTop ? awayColor : homeColor));
  });
}

function syncPanelVisibility() {
  if (getPageType?.() === "list") {
    syncListPanelVisibility();
    return;
  }

  invalidateChartCache?.();
  const targets = findChartTargets?.() || [];
  const visibleByType = new Map();

  for (const target of targets) {
    const type = target.sectionType || "main";
    visibleByType.set(
      type,
      isChartPlotVisible(target.plot, target.root, target.section)
    );
  }

  document.querySelectorAll(`.${OVERLAY_CLASS}[data-chart-type]`).forEach((panel) => {
    const type = panel.dataset.chartType || "main";
    const visible = visibleByType.has(type) ? visibleByType.get(type) : false;
    panel.style.display = visible ? "" : "none";
  });

  for (const [, data] of attached) {
    const visible = visibleByType.has(data.chartType)
      ? visibleByType.get(data.chartType)
      : isChartPlotVisible(data.plot, data.chartRoot, data.section);

    if (data.panel?.isConnected) {
      data.panel.style.display = visible ? "" : "none";
    }

    if (data.markers?.isConnected) {
      data.markers._sectionHidden = !visible;
    }

    if (!data.markers?.isConnected) continue;

    if (!visible) {
      data.markers.style.display = "none";
    } else {
      layoutMarkers(data.chartRoot, data.markers, {
        plot: data.plot,
        section: data.section,
      });
    }
  }
}

function syncListPanelVisibility() {
  for (const [, data] of attached) {
    const visible = isListGameVisible(data.plot, data.chartRoot, data.listEntry);

    if (data.panel?.isConnected) {
      data.panel.style.display = visible ? "" : "none";
    }

    if (data.markers?.isConnected) {
      data.markers._sectionHidden = !visible;
      if (!visible) {
        data.markers.style.display = "none";
      } else {
        layoutMarkers(data.chartRoot, data.markers, {
          plot: data.plot,
          section: data.listEntry?.panel || data.card || data.section,
        });
      }
    }
  }

  document.querySelectorAll(`.${OVERLAY_CLASS}[data-slug-key]`).forEach((panel) => {
    const slugKey = panel.dataset.slugKey;
    let visible = false;
    for (const [, data] of attached) {
      if (data.slugKey !== slugKey) continue;
      visible = isListGameVisible(data.plot, data.chartRoot, data.listEntry);
      break;
    }
    panel.style.display = visible ? "" : "none";
  });
}

const MARKET_SECTION_TYPES = ["moneyline", "spread", "total", "main"];

function setSectionOverlaysVisible(chartType, visible) {
  document
    .querySelectorAll(`.${OVERLAY_CLASS}[data-chart-type="${chartType}"]`)
    .forEach((panel) => {
      panel.style.display = visible ? "" : "none";
    });

  for (const [, data] of attached) {
    if (data.chartType !== chartType) continue;
    if (data.panel?.isConnected) {
      data.panel.style.display = visible ? "" : "none";
    }
    if (!data.markers?.isConnected) continue;
    data.markers._sectionHidden = !visible;
    if (!visible) {
      data.markers.style.display = "none";
    }
  }
}

function hidePanelsExcept(activeType) {
  for (const type of MARKET_SECTION_TYPES) {
    if (type === activeType) continue;
    setSectionOverlaysVisible(type, false);
  }
}

function hideAllPanelsImmediately() {
  for (const type of MARKET_SECTION_TYPES) {
    setSectionOverlaysVisible(type, false);
  }
}

function scheduleVisibilitySync() {
  syncPanelVisibility();
  requestAnimationFrame(() => syncPanelVisibility());
  for (const ms of [50, 150, 350, 800]) {
    setTimeout(() => syncPanelVisibility(), ms);
  }
}

function buildPanel(timeline, chartColors) {
  const { game, events } = timeline;
  const awayColor = chartColors?.away || teamUIColor(game.away.abbr);
  const homeColor = chartColors?.home || teamUIColor(game.home.abbr);
  const awayName = teamDisplayName(game.away);
  const homeName = teamDisplayName(game.home);

  const root = document.createElement("div");
  root.className = OVERLAY_CLASS;
  root.innerHTML = `
    <div class="ps-panel">
      <button class="ps-panel-toggle" type="button" aria-expanded="true">
        <div class="ps-panel-bar">
          <span class="ps-badge ps-badge-final">Final</span>
          <div class="ps-scoreboard">
            <span class="ps-team-name" style="--team-color:${awayColor}">${awayName}</span>
            <span class="ps-team-score">${game.away.score}</span>
            <span class="ps-score-divider">–</span>
            <span class="ps-team-score">${game.home.score}</span>
            <span class="ps-team-name" style="--team-color:${homeColor}">${homeName}</span>
          </div>
          <div class="ps-bar-right">
            <span class="ps-events-pill">${events.length} plays</span>
            <svg class="ps-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
        </div>
      </button>
      <div class="ps-panel-body">
        <div class="ps-timeline-header">
          <span>Time</span>
          <span>Inning</span>
          <span>Score</span>
          <span>Play</span>
        </div>
        <div class="ps-timeline-scroll">
          <div class="ps-timeline-rows"></div>
        </div>
      </div>
    </div>
  `;

  const rowsEl = root.querySelector(".ps-timeline-rows");
  const toggle = root.querySelector(".ps-panel-toggle");
  const body = root.querySelector(".ps-panel-body");

  for (const ev of events) {
    const isTop = ev.halfLabel === "Top";
    const pillColor = isTop ? awayColor : homeColor;

    const row = document.createElement("div");
    row.className = "ps-timeline-row";
    row.innerHTML = `
      <span class="ps-cell ps-cell-time">${ev.timestamp ? formatTime(ev.timestamp) : "—"}</span>
      <span class="ps-cell ps-cell-inning">
        <span class="ps-inning-pill" style="${inningPillStyle(pillColor)}">${ev.halfLabel} ${ev.inning}</span>
      </span>
      <span class="ps-cell ps-cell-score">${formatScore(ev.awayScore, ev.homeScore)}</span>
      <span class="ps-cell ps-cell-detail" title="${(ev.description || "").replace(/"/g, "&quot;")}">${ev.description || `${ev.runs || 1} run${(ev.runs || 1) > 1 ? "s" : ""}`}</span>
    `;
    rowsEl.appendChild(row);
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const collapsed = body.classList.toggle("ps-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  return root;
}

function buildBoundaryMarker(kind, timestamp, label) {
  const timeLabel = formatTime(timestamp);
  const marker = document.createElement("div");
  marker.className = `ps-boundary ps-boundary-${kind}`;
  marker.dataset.timestamp = String(timestamp);
  marker.innerHTML = `
    <div class="ps-boundary-line"></div>
    <div class="ps-boundary-hit">
      <div class="ps-boundary-label">${label}</div>
      <div class="ps-boundary-tooltip">${timeLabel}</div>
    </div>
  `;
  return marker;
}

function buildMarkersLayer(timeline, alignment, chartColors) {
  const { game, events } = timeline;
  const awayColor = chartColors?.away || teamUIColor(game.away.abbr);
  const homeColor = chartColors?.home || teamUIColor(game.home.abbr);

  const layer = document.createElement("div");
  layer.className = MARKERS_CLASS;
  layer._alignment = alignment;
  layer._chartRoot = alignment.chartRoot;

  if (alignment.gameStart) {
    layer.appendChild(
      buildBoundaryMarker("start", alignment.gameStart, "Start")
    );
  }
  if (alignment.gameEnd) {
    layer.appendChild(buildBoundaryMarker("end", alignment.gameEnd, "End"));
  }

  for (const ev of events) {
    if (!ev.timestamp) continue;

    const teamColor =
      ev.scoringTeam === game.away.abbr.toUpperCase() ? awayColor : homeColor;

    const marker = document.createElement("div");
    marker.className = "ps-marker";
    marker.style.setProperty("--marker-color", teamColor);
    marker.dataset.timestamp = String(ev.timestamp);
    marker.innerHTML = `
      <div class="ps-marker-line"></div>
      <div class="ps-marker-dot"></div>
    `;
    layer.appendChild(marker);
  }

  return layer;
}

function refreshMarkerPositions(markersLayer) {
  const alignment = markersLayer._alignment;
  if (!alignment) return;

  markersLayer.querySelectorAll(".ps-marker, .ps-boundary").forEach((marker) => {
    const ts = parseInt(marker.dataset.timestamp, 10);
    const pos = alignment.positionFn(ts);
    if (pos === null || pos === undefined) {
      marker.style.display = "none";
    } else {
      marker.style.display = "";
      marker.style.left = `${pos * 100}%`;
    }
  });
}

function layoutMarkers(chartRoot, markersLayer, options = {}) {
  const plot =
    options.plot ||
    markersLayer._plot ||
    markersLayer._alignment?.plot ||
    markersLayer._alignment?.layoutEl ||
    getLayoutElement(chartRoot) ||
    getPlotArea(chartRoot);
  if (!plot || !markersLayer?.isConnected) return;

  const plotR = plot.getBoundingClientRect();
  if (plotR.width < 10 || plotR.height < 10) {
    markersLayer.style.display = "none";
    return;
  }

  if (markersLayer._sectionHidden) {
    markersLayer.style.display = "none";
    return;
  }

  markersLayer.style.display = "block";
  markersLayer.style.position = "fixed";
  markersLayer.style.top = `${plotR.top}px`;
  markersLayer.style.left = `${plotR.left}px`;
  markersLayer.style.width = `${plotR.width}px`;
  markersLayer.style.height = `${plotR.height}px`;

  if (options.refreshAxis) {
    markersLayer._alignment?.refreshAxis?.();
  }
  refreshMarkerPositions(markersLayer);
}

function layoutAllMarkers(refreshAxis = false) {
  for (const [, data] of attached) {
    if (data.markers?.isConnected) {
      layoutMarkers(data.chartRoot, data.markers, {
        refreshAxis,
        plot: data.plot,
        section: data.section,
      });
    }
  }
}

function relayoutAllMarkers(refreshAxis = false) {
  syncPanelVisibility();
  layoutAllMarkers(refreshAxis);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function onScrollOrResize(e) {
  if (!attached.size) return;
  if (e?.target?.closest?.(".ps-timeline-scroll, .poly-score-root")) return;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    layoutAllMarkers(false);
  });
}

function ensureGlobalListeners() {
  if (ensureGlobalListeners._on) return;
  ensureGlobalListeners._on = true;
  window.addEventListener("resize", debounce(onScrollOrResize, 500), { passive: true });
  window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
}

function detachPlot(stableKey) {
  const data = attached.get(stableKey);
  if (!data) return;
  data.markers?.remove();
  attached.delete(stableKey);
}

function detachChart(chartRoot) {
  const plot = getPlotArea(chartRoot);
  if (!plot) return;
  const stableKey = plotStableKey(plot, detectChartTypeFromPlot(plot));
  if (stableKey) detachPlot(stableKey);
}

function removePanel(panelKey) {
  const panel = pagePanels.get(panelKey);
  if (panel?.isConnected) panel.remove();
  pagePanels.delete(panelKey);
}

function resetPagePanels() {
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  pagePanels.clear();
}

function cleanupOrphans() {
  for (const [plotKey, data] of attached) {
    if (
      !data.plot?.isConnected ||
      !data.chartRoot?.isConnected ||
      !data.markers?.isConnected
    ) {
      data.markers?.remove();
      attached.delete(plotKey);
    }
  }

  document.querySelectorAll(`.${MARKERS_CLASS}`).forEach((el) => {
    const key = el._plotKey;
    if (!key || !attached.has(key)) el.remove();
  });

  const slugKey = document.querySelector(`.${OVERLAY_CLASS}[data-slug-key]`)?.dataset
    .slugKey;
  if (slugKey) dedupePagePanels(slugKey);
}

function pickPrimaryChart(charts) {
  if (!charts.length) return null;
  return charts.sort((a, b) => {
    const pa = getPlotArea(a);
    const pb = getPlotArea(b);
    const ra = pa?.getBoundingClientRect() || { width: 0, height: 0 };
    const rb = pb?.getBoundingClientRect() || { width: 0, height: 0 };
    return rb.width * rb.height - ra.width * ra.height;
  })[0];
}

function isPlotAttached(plot, sectionType = null, slugKey = null) {
  if (!plot?.isConnected) return false;

  const chartType = sectionType || detectChartTypeFromPlot(plot);

  for (const [, data] of attached) {
    if (
      data.plot === plot &&
      data.chartType === chartType &&
      (!slugKey || data.slugKey === slugKey) &&
      data.markers?.isConnected
    ) {
      return true;
    }
  }

  const stableKey = plotStableKey(plot, chartType, slugKey);
  const data = attached.get(stableKey);
  return Boolean(
    data?.markers?.isConnected &&
      data.plot === plot &&
      data.chartType === chartType &&
      (!slugKey || data.slugKey === slugKey)
  );
}

function isChartAttached(chartRoot) {
  const plot = getPlotArea(chartRoot);
  return plot ? isPlotAttached(plot) : false;
}

async function attachToChart(chartRoot, timeline, options = {}) {
  const plot = options.plot || getPlotArea(chartRoot);
  if (!plot) return;

  const chartType =
    options.sectionType ||
    detectChartTypeFromPlot(plot) ||
    detectChartType(chartRoot, options.sectionType);
  const stableKey = plotStableKey(plot, chartType, options.slugKey);
  if (!stableKey || !options.slugKey) return;

  const sectionLock = `${options.slugKey}-${chartType}`;
  if (attachingSections.has(sectionLock)) return;
  if (isPlotAttached(plot, chartType, options.slugKey)) return;

  attachingSections.add(sectionLock);

  try {
    for (const [key, data] of attached) {
      if (data.plot === plot && data.chartType === chartType) {
        detachPlot(key);
      }
    }
    registerChartRoot(chartRoot, plot);

    const alignment = await resolveChartAlignment(
      chartRoot,
      timeline,
      options.slug || null,
      chartType
    );
    alignment.plot = plot;
    alignment.layoutEl = plot;

    const anchor = options.anchor || chartRoot;
    const section = options.section || null;
    const card = options.card || null;
    const listEntry = options.listEntry || null;

    const chartColors = extractChartTeamColors(chartRoot, timeline.game, chartType);
    const markers = buildMarkersLayer(timeline, alignment, chartColors);
    markers._plotKey = stableKey;
    markers._plot = plot;
    markers._chartRoot = chartRoot;
    markers._section = section;
    document.body.appendChild(markers);
    ensureGlobalListeners();

    let panel = null;

    if (options.showPanel) {
      const panelKey = panelKeyFor(options.slugKey, chartRoot, plot, chartType);
      panel = removePanelsForSection(options.slugKey, chartType);

      if (!panel) {
        panel = buildPanel(timeline, chartColors);
        panel.dataset.slugKey = options.slugKey;
        panel.dataset.panelKey = panelKey;
        panel.dataset.chartType = chartType;
        if (options.compact) panel.classList.add("ps-compact");
      } else {
        updatePanelColors(panel, chartColors, timeline);
      }

      pagePanels.set(panelKey, panel);
      if (listEntry) {
        placeListPanel(panel, anchor, listEntry);
      } else {
        placePanel(panel, anchor, card || section);
      }
    }

    layoutMarkers(chartRoot, markers, {
      refreshAxis: true,
      plot,
      section: listEntry?.panel || card || section,
    });
    attached.set(stableKey, {
      markers,
      panel,
      chartRoot,
      plot,
      chartType,
      section,
      card,
      listEntry,
      slugKey: options.slugKey,
    });
    syncPanelVisibility();

    setTimeout(
      () =>
        layoutMarkers(chartRoot, markers, {
          refreshAxis: true,
          plot,
          section: card || section,
        }),
      800
    );
    setTimeout(
      () =>
        layoutMarkers(chartRoot, markers, {
          refreshAxis: true,
          plot,
          section: card || section,
        }),
      2500
    );
  } finally {
    attachingSections.delete(sectionLock);
  }
}

window.relayoutMarkers = () => {
  relayoutAllMarkers(true);
  setTimeout(() => relayoutAllMarkers(true), 400);
  setTimeout(() => relayoutAllMarkers(true), 1200);
  setTimeout(() => relayoutAllMarkers(true), 2200);
};
window.layoutAllMarkers = layoutAllMarkers;
window.relayoutAllMarkers = relayoutAllMarkers;
window.syncPanelVisibility = syncPanelVisibility;
window.hidePanelsExcept = hidePanelsExcept;
window.hideAllPanelsImmediately = hideAllPanelsImmediately;
window.scheduleVisibilitySync = scheduleVisibilitySync;
window.PolyScoreOverlay = { attachToChart, detachChart, pickPrimaryChart };
window.attachToChart = attachToChart;
window.cleanupOrphans = cleanupOrphans;
window.resetPagePanels = resetPagePanels;
window.chartFingerprint = chartFingerprint;
window.pickPrimaryChart = pickPrimaryChart;
window.slugKeyFrom = slugKeyFrom;
window.panelKeyFor = panelKeyFor;
window.isPlotAttached = isPlotAttached;
window.isChartAttached = isChartAttached;
window.dedupePagePanels = dedupePagePanels;
window.sectionHasPanel = (slugKey, chartType) =>
  Boolean(getSectionPanel(slugKey, chartType));
