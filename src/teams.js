/**
 * Polymarket slug abbreviations → MLB Stats API team IDs
 */
const POLY_TO_MLB = {
  ari: 109, atl: 144, bal: 110, bos: 111, chc: 112, cws: 145, cin: 113,
  cle: 114, col: 115, det: 116, hou: 117, kc: 118, laa: 108, lad: 119,
  mia: 146, mil: 158, min: 142, nym: 121, nyy: 147, oak: 133, phi: 143,
  pit: 134, sd: 135, sf: 137, sea: 136, stl: 138, tb: 139, tex: 140,
  tor: 141, wsh: 120,
};

const MLB_TO_POLY = Object.fromEntries(
  Object.entries(POLY_TO_MLB).map(([k, v]) => [v, k])
);

const TEAM_COLORS = {
  ari: "#A71930", atl: "#CE1141", bal: "#DF4601", bos: "#BD3039", chc: "#0E3386",
  cws: "#27251F", cin: "#C6011F", cle: "#E31937", col: "#33006F", det: "#0C2340",
  hou: "#EB6E1F", kc: "#004687", laa: "#BA0021", lad: "#005A9C", mia: "#00A3E0",
  mil: "#FFC52F", min: "#002B5C", nym: "#002D72", nyy: "#003087", oak: "#003831",
  phi: "#E81828", pit: "#FDB827", sd: "#2F241D", sf: "#FD5A1E", sea: "#0C2C56",
  stl: "#C41E3A", tb: "#092C5C", tex: "#003278", tor: "#134A8E", wsh: "#AB0003",
};

const TEAM_NAMES = {
  ari: "Diamondbacks", atl: "Braves", bal: "Orioles", bos: "Red Sox", chc: "Cubs",
  cws: "White Sox", cin: "Reds", cle: "Guardians", col: "Rockies", det: "Tigers",
  hou: "Astros", kc: "Royals", laa: "Angels", lad: "Dodgers", mia: "Marlins",
  mil: "Brewers", min: "Twins", nym: "Mets", nyy: "Yankees", oak: "Athletics",
  phi: "Phillies", pit: "Pirates", sd: "Padres", sf: "Giants", sea: "Mariners",
  stl: "Cardinals", tb: "Rays", tex: "Rangers", tor: "Blue Jays", wsh: "Nationals",
};

function hexToRgb(hex) {
  const raw = (hex || "#888888").replace("#", "");
  const full =
    raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(r, g, b) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Brighten dark MLB brand colors for readable UI on Polymarket's dark theme */
function teamUIColor(abbr) {
  const base = TEAM_COLORS[abbr];
  if (!base) return "#94a3b8";
  const { r, g, b } = hexToRgb(base);
  if (relativeLuminance(r, g, b) >= 0.22) return base;

  const blend = (c, target, t) => Math.round(c + (target - c) * t);
  const target =
    b > r && b >= g
      ? { r: 91, g: 164, b: 255 }
      : { r: 255, g: 82, b: 98 };

  return `#${[blend(r, target.r, 0.75), blend(g, target.g, 0.75), blend(b, target.b, 0.75)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function inningPillStyle(color) {
  const { r, g, b } = hexToRgb(color);
  return [
    `--pill-color:${color}`,
    `background:rgba(${r},${g},${b},0.22)`,
    `color:${color}`,
    `border:1px solid rgba(${r},${g},${b},0.5)`,
  ].join(";");
}

window.PolyScoreTeams = {
  POLY_TO_MLB,
  MLB_TO_POLY,
  TEAM_COLORS,
  TEAM_NAMES,
  teamUIColor,
  inningPillStyle,
};
/* globals for sibling content scripts */
window.POLY_TO_MLB = POLY_TO_MLB;
window.TEAM_COLORS = TEAM_COLORS;
window.TEAM_NAMES = TEAM_NAMES;
window.teamUIColor = teamUIColor;
window.inningPillStyle = inningPillStyle;
