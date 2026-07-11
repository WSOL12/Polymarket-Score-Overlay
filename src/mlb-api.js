/**
 * MLB Stats API — game lookup and scoring timeline
 */
const MLB_API = "https://statsapi.mlb.com/api/v1";
const MLB_FEED = "https://statsapi.mlb.com/api/v1.1";

const gameCache = new Map();
const feedCache = new Map();

function parseGameSlug(slug) {
  const m = slug.match(/^mlb-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  return { away: m[1], home: m[2], date: m[3] };
}

function parseGameUrl() {
  const m = location.pathname.match(/\/sports\/mlb\/(mlb-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2})/);
  return m ? parseGameSlug(m[1]) : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API ${res.status}`);
  return res.json();
}

async function findGame(awayAbbr, homeAbbr, date) {
  const key = `${awayAbbr}-${homeAbbr}-${date}`;
  if (gameCache.has(key)) return gameCache.get(key);

  const awayId = POLY_TO_MLB[awayAbbr];
  const homeId = POLY_TO_MLB[homeAbbr];
  if (!awayId || !homeId) return null;

  const data = await fetchJson(
    `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=linescore`
  );
  const games = data.dates?.[0]?.games ?? [];

  const game = games.find((g) => {
    const a = g.teams.away.team.id;
    const h = g.teams.home.team.id;
    return (a === awayId && h === homeId) || (a === homeId && h === awayId);
  });

  if (!game) return null;

  const awayIsPolyAway = game.teams.away.team.id === awayId;
  const result = {
    gamePk: game.gamePk,
    status: game.status.detailedState,
    isFinal: game.status.abstractGameState === "Final",
    gameDate: game.gameDate,
    away: {
      abbr: awayAbbr,
      name: game.teams[awayIsPolyAway ? "away" : "home"].team.name,
      score: game.teams[awayIsPolyAway ? "away" : "home"].score,
    },
    home: {
      abbr: homeAbbr,
      name: game.teams[awayIsPolyAway ? "home" : "away"].team.name,
      score: game.teams[awayIsPolyAway ? "home" : "away"].score,
    },
    linescore: game.linescore,
  };

  gameCache.set(key, result);
  return result;
}

function extractScoringPlays(feed, awayAbbr, homeAbbr) {
  const plays = feed.liveData?.plays?.allPlays ?? [];
  const events = [];

  for (const play of plays) {
    if (!play.about?.isScoringPlay) continue;

    const awayScore = play.result?.awayScore ?? 0;
    const homeScore = play.result?.homeScore ?? 0;
    const inning = play.about.inning;
    const half = play.about.halfInning;
    const ts = Date.parse(play.about.endTime || play.about.startTime);

    events.push({
      timestamp: ts,
      inning,
      half,
      halfLabel: half === "top" ? "Top" : "Bot",
      awayScore,
      homeScore,
      description: play.result?.description || "",
      scoringTeam:
        play.about.isTopInning
          ? awayAbbr.toUpperCase()
          : homeAbbr.toUpperCase(),
    });
  }

  return events;
}

function buildInningSummary(linescore, awayAbbr, homeAbbr) {
  if (!linescore?.innings) return [];

  let awayTotal = 0;
  let homeTotal = 0;
  const rows = [];

  for (const inn of linescore.innings) {
    const awayRuns = inn.away?.runs ?? 0;
    const homeRuns = inn.home?.runs ?? 0;

    if (awayRuns > 0) {
      awayTotal += awayRuns;
      rows.push({
        inning: inn.num,
        half: "top",
        halfLabel: "Top",
        runs: awayRuns,
        awayScore: awayTotal,
        homeScore: homeTotal,
        scoringTeam: awayAbbr.toUpperCase(),
        isHalfInning: true,
      });
    }

    homeTotal += homeRuns;
    if (homeRuns > 0) {
      rows.push({
        inning: inn.num,
        half: "bottom",
        halfLabel: "Bot",
        runs: homeRuns,
        awayScore: awayTotal,
        homeScore: homeTotal,
        scoringTeam: homeAbbr.toUpperCase(),
        isHalfInning: true,
      });
    }
  }

  return rows;
}

async function getGameTimeline(awayAbbr, homeAbbr, date) {
  const game = await findGame(awayAbbr, homeAbbr, date);
  if (!game || !game.isFinal) return null;

  const feedKey = String(game.gamePk);
  let feed = feedCache.get(feedKey);
  if (!feed) {
    feed = await fetchJson(`${MLB_FEED}/game/${game.gamePk}/feed/live`);
    feedCache.set(feedKey, feed);
  }

  let events = extractScoringPlays(feed, awayAbbr, homeAbbr);

  if (events.length === 0 && game.linescore) {
    events = buildInningSummary(game.linescore, awayAbbr, homeAbbr).map((row, i) => ({
      ...row,
      timestamp: Date.parse(game.gameDate) + (i + 1) * 18 * 60 * 1000,
      description: `${row.runs} run${row.runs > 1 ? "s" : ""}`,
    }));
  }

  const gameStart = Date.parse(game.gameDate);
  const gameEnd = events.length
    ? Math.max(...events.map((e) => e.timestamp))
    : gameStart + 3 * 60 * 60 * 1000;

  return {
    game,
    events,
    timeRange: { start: gameStart, end: gameEnd + 30 * 60 * 1000 },
  };
}

window.PolyScoreMLB = {
  parseGameSlug,
  parseGameUrl,
  findGame,
  getGameTimeline,
};
window.parseGameSlug = parseGameSlug;
window.parseGameUrl = parseGameUrl;
window.getGameTimeline = getGameTimeline;
