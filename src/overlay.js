/**
 * Score overlay — markers on body (fixed), zero injection into React chart DOM
 */
const OVERLAY_CLASS = "poly-score-root";
const MARKERS_CLASS = "poly-score-markers";
const attached = new Map();
const pagePanels = new Map();

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

function chartFingerprint(chartRoot) {
  const plot = getPlotArea(chartRoot);
  if (!plot) return `chart-${++overlaySeq}`;
  const w = plot.getAttribute("width");
  const h = plot.getAttribute("height");
  const type = detectChartType(chartRoot);
  const r = plot.getBoundingClientRect();
  return `${type}-${Math.round(r.top)}-${Math.round(r.left)}-${w}x${h}`;
}

function teamDisplayName(team) {
  return TEAM_NAMES[team.abbr] || team.name || team.abbr.toUpperCase();
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
  const plot = markersLayer._alignment?.layoutEl || getLayoutElement(chartRoot) || getPlotArea(chartRoot);
  if (!plot || !markersLayer?.isConnected) return;

  const plotR = plot.getBoundingClientRect();
  if (plotR.width < 10 || plotR.height < 10) {
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
  for (const [chartRoot, data] of attached) {
    if (data.markers?.isConnected) {
      layoutMarkers(chartRoot, data.markers, { refreshAxis });
    }
  }
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

function detachChart(chartRoot) {
  const data = attached.get(chartRoot);
  if (!data) return;
  data.markers?.remove();
  attached.delete(chartRoot);
}

function panelKeyFor(slugKey, chartRoot) {
  return `${slugKey}-${chartFingerprint(chartRoot)}`;
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
  for (const [chartRoot, data] of attached) {
    if (!chartRoot.isConnected || !data.markers?.isConnected) {
      data.markers?.remove();
      attached.delete(chartRoot);
    }
  }

  document.querySelectorAll(`.${MARKERS_CLASS}`).forEach((el) => {
    if (!attached.has(el._chartRoot)) el.remove();
  });
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

function isChartAttached(chartRoot) {
  const data = attached.get(chartRoot);
  return Boolean(data?.markers?.isConnected && chartRoot.isConnected);
}

async function attachToChart(chartRoot, timeline, options = {}) {
  if (isChartAttached(chartRoot)) return;

  detachChart(chartRoot);

  const alignment = await resolveChartAlignment(
    chartRoot,
    timeline,
    options.slug || null,
    detectChartType(chartRoot)
  );

  const chartColors = extractChartTeamColors(chartRoot, timeline.game);
  const markers = buildMarkersLayer(timeline, alignment, chartColors);
  document.body.appendChild(markers);
  ensureGlobalListeners();

  let panel = null;
  const panelKey =
    options.panelKey ||
    (options.slugKey ? panelKeyFor(options.slugKey, chartRoot) : null);

  if (options.showPanel && panelKey) {
    removePanel(panelKey);

    panel = buildPanel(timeline, chartColors);
    panel.dataset.slugKey = options.slugKey;
    panel.dataset.panelKey = panelKey;
    pagePanels.set(panelKey, panel);

    chartRoot.insertAdjacentElement("afterend", panel);
  }

  layoutMarkers(chartRoot, markers, { refreshAxis: true });
  attached.set(chartRoot, { markers, panel });

  setTimeout(() => layoutMarkers(chartRoot, markers, { refreshAxis: true }), 800);
  setTimeout(() => layoutMarkers(chartRoot, markers, { refreshAxis: true }), 2500);
}

window.relayoutMarkers = () => {
  layoutAllMarkers(true);
  setTimeout(() => layoutAllMarkers(true), 400);
  setTimeout(() => layoutAllMarkers(true), 1200);
  setTimeout(() => layoutAllMarkers(true), 2200);
};
window.layoutAllMarkers = layoutAllMarkers;
window.PolyScoreOverlay = { attachToChart, detachChart, pickPrimaryChart };
window.attachToChart = attachToChart;
window.cleanupOrphans = cleanupOrphans;
window.resetPagePanels = resetPagePanels;
window.chartFingerprint = chartFingerprint;
window.pickPrimaryChart = pickPrimaryChart;
window.slugKeyFrom = slugKeyFrom;
window.panelKeyFor = panelKeyFor;
