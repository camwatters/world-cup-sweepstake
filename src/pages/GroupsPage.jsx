import { useEffect, useState } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { getCached, setCache, TTL } from "../utils/cache";
import styles from "./GroupsPage.module.css";

const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";

function scoreboardUrl() {
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=50&dates=${fmt(from)}-${fmt(to)}`;
}

// Completed group-stage results from start of tournament to today (for H2H data)
function groupStageHistoryUrl() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260612-${today}`;
}

const CACHE_KEY_STANDINGS = "espn_standings";
const CACHE_KEY_SCOREBOARD = `espn_scoreboard_${new Date().toISOString().slice(0, 10)}`;
const CACHE_KEY_GS_HISTORY = `espn_gs_history_${new Date().toISOString().slice(0, 10)}`;

const ESPN_ALIASES = {
  "czechia": "czech republic",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "türkiye": "turkey",
  "united states": "usa",
  "curaçao": "curacao",
  "congo dr": "dr congo",
};

const teamLookup = {};
draw.forEach((e) => {
  teamLookup[e.team.toLowerCase()] = e;
});

function findEntry(espnName) {
  if (!espnName) return null;
  const lower = espnName.toLowerCase();
  const resolved = ESPN_ALIASES[lower] ?? lower;
  if (teamLookup[resolved]) return teamLookup[resolved];
  for (const [key, val] of Object.entries(teamLookup)) {
    if (resolved.includes(key) || key.includes(resolved)) return val;
  }
  return null;
}

async function fetchWithCache(url, cacheKey, ttl) {
  const cached = getCached(cacheKey, ttl);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

function getStats(entry) {
  return Object.fromEntries((entry.stats ?? []).map((s) => [s.name, s.value]));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const sa = getStats(a), sb = getStats(b);
    return (sb.points ?? 0) - (sa.points ?? 0)
      || (sb.pointDifferential ?? 0) - (sa.pointDifferential ?? 0)
      || (sb.pointsFor ?? sb.goalsScored ?? 0) - (sa.pointsFor ?? sa.goalsScored ?? 0);
  });
}

// Build per-group fixture data.
// historyEvents: completed group-stage results (for H2H tiebreaker data).
//   We don't rely on groups.name here — ESPN doesn't always set it on
//   historical events — instead we match teams against the standings map.
// upcomingEvents: scheduled games from the regular scoreboard (remaining fixtures).
function buildFixtureData(historyEvents, upcomingEvents, groups) {
  const teamToGroup = {};
  groups.forEach((group) => {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter || letter.length > 1) return;
    (group.standings?.entries ?? []).forEach((e) => {
      const name = (e.team?.displayName ?? "").toLowerCase();
      if (name) teamToGroup[name] = letter;
    });
  });

  const groupFixtures = {};
  const ensure = (l) => { if (!groupFixtures[l]) groupFixtures[l] = { completed: [], remaining: [] }; };

  // Completed results: match by team membership, ignore groups.name
  (historyEvents ?? []).forEach((event) => {
    const comp = event.competitions?.[0];
    if (!comp?.status?.type?.completed) return;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home || !away) return;
    const homeName = home.team?.displayName ?? "";
    const awayName = away.team?.displayName ?? "";
    const letter = teamToGroup[homeName.toLowerCase()] ?? teamToGroup[awayName.toLowerCase()];
    if (!letter) return;
    ensure(letter);
    groupFixtures[letter].completed.push({
      home: homeName,
      away: awayName,
      homeScore: parseInt(home.score ?? "0") || 0,
      awayScore: parseInt(away.score ?? "0") || 0,
    });
  });

  // Remaining fixtures: strict group-stage filter on upcoming events
  (upcomingEvents ?? []).forEach((event) => {
    const comp = event.competitions?.[0];
    if ((comp?.groups?.name ?? "") !== "group-stage") return;
    if (comp?.status?.type?.completed) return;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home || !away) return;
    const homeName = home.team?.displayName ?? "";
    const awayName = away.team?.displayName ?? "";
    const letter = teamToGroup[homeName.toLowerCase()] ?? teamToGroup[awayName.toLowerCase()];
    if (!letter) return;
    ensure(letter);
    groupFixtures[letter].remaining.push({ home: homeName, away: awayName });
  });

  return groupFixtures;
}

// Enumerate all possible outcomes of remaining games and return the set of
// positions each team can finish in. Uses FIFA WC tiebreaker order:
// pts → H2H pts → H2H GD → H2H GF → overall GD → overall GF
function computeFeasiblePositions(groupEntry, fixtureData) {
  const letter = (groupEntry.name ?? "").replace("Group ", "").trim();
  const fixtures = fixtureData?.[letter];
  if (!fixtures) return null; // no data for this group

  const getStatsLocal = (e) => Object.fromEntries((e.stats ?? []).map((s) => [s.name, s.value]));
  const teams = (groupEntry.standings?.entries ?? []).map((e) => {
    const st = getStatsLocal(e);
    return {
      name: e.team?.displayName ?? "",
      pts: st.points ?? 0,
      gd: st.pointDifferential ?? 0,
      gf: st.pointsFor ?? 0,
    };
  });
  if (teams.length === 0) return null;

  // Build H2H lookup from completed matches
  const h2h = {};
  fixtures.completed.forEach(({ home, away, homeScore, awayScore }) => {
    const key = [home, away].sort().join("|");
    const hPts = homeScore > awayScore ? 3 : homeScore === awayScore ? 1 : 0;
    const aPts = awayScore > homeScore ? 3 : homeScore === awayScore ? 1 : 0;
    h2h[key] = {
      [home]: { pts: hPts, gd: homeScore - awayScore, gf: homeScore },
      [away]: { pts: aPts, gd: awayScore - homeScore, gf: awayScore },
    };
  });

  function rankTeams(simTeams, simH2H) {
    return [...simTeams].sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      // H2H between this pair
      const key = [a.name, b.name].sort().join("|");
      const m = simH2H[key];
      if (m?.[a.name] && m?.[b.name]) {
        const aH = m[a.name], bH = m[b.name];
        if (bH.pts !== aH.pts) return bH.pts - aH.pts;
        if (bH.gd !== aH.gd) return bH.gd - aH.gd;
        if (bH.gf !== aH.gf) return bH.gf - aH.gf;
      }
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
  }

  const remaining = fixtures.remaining;
  const possiblePositions = {};
  teams.forEach((t) => (possiblePositions[t.name] = new Set()));

  const total = 3 ** remaining.length; // W/D/L per remaining game
  for (let i = 0; i < total; i++) {
    const simTeams = teams.map((t) => ({ ...t }));
    const simH2H = Object.fromEntries(Object.entries(h2h).map(([k, v]) => [k, { ...v }]));
    let code = i;

    for (let j = 0; j < remaining.length; j++) {
      const outcome = code % 3; // 0=homeWin 1=draw 2=awayWin
      code = Math.floor(code / 3);
      const game = remaining[j];
      const homeT = simTeams.find((t) => t.name === game.home);
      const awayT = simTeams.find((t) => t.name === game.away);
      if (!homeT || !awayT) continue;

      // Synthetic score: 1-0 win, 0-0 draw, 0-1 loss
      const hScore = outcome === 0 ? 1 : 0;
      const aScore = outcome === 2 ? 1 : 0;
      const hPts = outcome === 0 ? 3 : outcome === 1 ? 1 : 0;
      const aPts = outcome === 2 ? 3 : outcome === 1 ? 1 : 0;

      homeT.pts += hPts; homeT.gd += hScore - aScore; homeT.gf += hScore;
      awayT.pts += aPts; awayT.gd += aScore - hScore; awayT.gf += aScore;

      const key = [game.home, game.away].sort().join("|");
      simH2H[key] = {
        [game.home]: { pts: hPts, gd: hScore - aScore, gf: hScore },
        [game.away]: { pts: aPts, gd: aScore - hScore, gf: aScore },
      };
    }

    rankTeams(simTeams, simH2H).forEach((t, idx) => {
      possiblePositions[t.name].add(idx + 1);
    });
  }

  return possiblePositions;
}

function computeQualifiers(groups, fixtureData = {}) {
  const winners = {}, runnersUp = {}, allThirds = [], completedGroups = new Set();
  const guaranteedWinners = new Set(), guaranteedRunnersUp = new Set();
  groups.forEach((group) => {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter) return;
    const sorted = sortEntries(group.standings?.entries ?? []);
    const allPlayed3 = sorted.length === 4 && sorted.every(e => (getStats(e).gamesPlayed ?? 0) >= 3);
    if (allPlayed3) completedGroups.add(letter);
    if (sorted[0]) winners[letter] = sorted[0].team?.displayName ?? "";
    if (sorted[1]) runnersUp[letter] = sorted[1].team?.displayName ?? "";

    // Feasibility analysis: mark teams whose position is mathematically locked
    const feasible = computeFeasiblePositions(group, fixtureData);
    if (feasible) {
      Object.entries(feasible).forEach(([teamName, positions]) => {
        if (positions.size === 1 && positions.has(1)) guaranteedWinners.add(teamName);
        if (positions.size === 1 && positions.has(2)) guaranteedRunnersUp.add(teamName);
      });
    }

    if (sorted[2]) {
      const st = getStats(sorted[2]);
      allThirds.push({
        group: letter,
        name: sorted[2].team?.displayName ?? "",
        played: st.gamesPlayed ?? 0,
        points: st.points ?? 0,
        gd: st.pointDifferential ?? 0,
        gf: st.pointsFor ?? 0,
        ga: st.pointsAgainst ?? 0,
      });
    }
  });
  // Sort by pts → GD → GF (FIFA tiebreak criteria for 3rd-place ranking)
  allThirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  const best8 = new Set(allThirds.slice(0, 8).map((t) => t.name));
  return { winners, runnersUp, allThirds, best8thirds: [...best8], completedGroups, guaranteedWinners, guaranteedRunnersUp };
}

// Static bracket from FIFA schedule (teams TBD after group stage, June 26+)
const R32_SCHEDULE = [
  { date: "28 Jun", venue: "Inglewood",    home: "Runner-up Group A", away: "Runner-up Group B" },
  { date: "29 Jun", venue: "Foxborough",   home: "Winner Group E",    away: "Best 3rd A/B/C/D/F" },
  { date: "29 Jun", venue: "Guadalupe",    home: "Winner Group F",    away: "Runner-up Group C" },
  { date: "29 Jun", venue: "Houston",      home: "Winner Group C",    away: "Runner-up Group F" },
  { date: "30 Jun", venue: "East Rutherford", home: "Winner Group I", away: "Best 3rd C/D/F/G/H" },
  { date: "30 Jun", venue: "Arlington",    home: "Runner-up Group E", away: "Runner-up Group I" },
  { date: "30 Jun", venue: "Mexico City",  home: "Winner Group A",    away: "Best 3rd C/E/F/H/I" },
  { date: "1 Jul",  venue: "Atlanta",      home: "Winner Group L",    away: "Best 3rd E/H/I/J/K" },
  { date: "1 Jul",  venue: "Santa Clara",  home: "Winner Group D",    away: "Best 3rd B/E/F/I/J" },
  { date: "1 Jul",  venue: "Seattle",      home: "Winner Group G",    away: "Best 3rd A/E/H/I/J" },
  { date: "2 Jul",  venue: "Toronto",      home: "Runner-up Group K", away: "Runner-up Group L" },
  { date: "2 Jul",  venue: "Inglewood",    home: "Winner Group H",    away: "Runner-up Group J" },
  { date: "2 Jul",  venue: "Vancouver",    home: "Winner Group B",    away: "Best 3rd E/F/G/I/J" },
  { date: "3 Jul",  venue: "Miami Gardens",home: "Winner Group J",    away: "Runner-up Group H" },
  { date: "3 Jul",  venue: "Arlington",    home: "Runner-up Group D", away: "Runner-up Group G" },
  { date: "3 Jul",  venue: "Kansas City",  home: "Winner Group K",    away: "Best 3rd D/E/I/J/L" },
];

export default function GroupsPage() {
  const [standings, setStandings] = useState(null);
  const [scoreboard, setScoreboard] = useState(null);
  const [historyEvents, setHistoryEvents] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("groups");

  useEffect(() => {
    Promise.all([
      fetchWithCache(ESPN_STANDINGS, CACHE_KEY_STANDINGS, TTL.STANDINGS),
      fetchWithCache(scoreboardUrl(), CACHE_KEY_SCOREBOARD, TTL.SCORES),
      fetchWithCache(groupStageHistoryUrl(), CACHE_KEY_GS_HISTORY, TTL.SCORES).catch(() => null),
    ])
      .then(([s, sc, hist]) => {
        setStandings(s);
        setScoreboard(sc);
        setHistoryEvents(hist?.events ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load ESPN data: {error}</p>
      </div>
    );
  }

  const groups = standings?.children ?? [];
  const events = scoreboard?.events ?? [];
  const fixtureData = buildFixtureData(historyEvents, events, groups);

  const knockoutEvents = events.filter((e) => {
    const groupName = e.competitions?.[0]?.groups?.name ?? "";
    return groupName !== "group-stage" && groupName !== "";
  });

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <button className={tab === "groups" ? styles.active : ""} onClick={() => setTab("groups")}>Groups</button>
        <button className={tab === "fixtures" ? styles.active : ""} onClick={() => setTab("fixtures")}>Fixtures</button>
        <button className={tab === "bracket" ? styles.active : ""} onClick={() => setTab("bracket")}>Bracket</button>
      </div>

      {tab === "groups" && (
        <div className={styles.groupsGrid}>
          {!standings && <p className={styles.loading}>Loading…</p>}
          {groups.length === 0 && standings && <p className={styles.empty}>No group data available yet.</p>}
          {groups.map((group) => (
            <GroupTable key={group.uid ?? group.name} group={group} />
          ))}
        </div>
      )}

      {tab === "fixtures" && (
        <FixturesTab events={events} loading={!scoreboard} />
      )}

      {tab === "bracket" && (
        <BracketTab knockoutEvents={knockoutEvents} qualifiers={computeQualifiers(groups, fixtureData)} />
      )}
    </div>
  );
}

function GroupTable({ group }) {
  const entries = [...(group.standings?.entries ?? [])].sort((a, b) => {
    const sa = Object.fromEntries((a.stats ?? []).map((s) => [s.name, s.value]));
    const sb = Object.fromEntries((b.stats ?? []).map((s) => [s.name, s.value]));
    return (sb.points ?? 0) - (sa.points ?? 0) || (sb.pointDifferential ?? 0) - (sa.pointDifferential ?? 0);
  });
  return (
    <div className={styles.groupCard}>
      <h3 className={styles.groupTitle}>{group.name ?? group.abbreviation}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.teamCol}>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const teamName = entry.team?.displayName ?? entry.team?.name ?? "";
            const sweepEntry = findEntry(teamName);
            const stats = Object.fromEntries(
              (entry.stats ?? []).map((s) => [s.name, s.value])
            );
            return (
              <tr key={entry.team?.id ?? teamName}>
                <td className={styles.teamCell}>
                  {sweepEntry ? (
                    <Flag code={sweepEntry.flag} size={20} />
                  ) : (
                    <img
                      src={entry.team?.logos?.[0]?.href}
                      width={30}
                      height={20}
                      alt=""
                      style={{ objectFit: "contain" }}
                    />
                  )}
                  <span className={styles.espnTeamName}>{teamName}</span>
                  {sweepEntry?.person && (
                    <span className={styles.ownerBadge}>{sweepEntry.person}</span>
                  )}
                </td>
                <td>{stats.gamesPlayed ?? 0}</td>
                <td>{stats.wins ?? 0}</td>
                <td>{stats.ties ?? 0}</td>
                <td>{stats.losses ?? 0}</td>
                <td>{stats.pointDifferential ?? 0}</td>
                <td><strong>{stats.points ?? 0}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FixturesTab({ events, loading }) {
  if (loading) return <p className={styles.loading}>Loading…</p>;
  if (events.length === 0) return <p className={styles.empty}>No fixtures available.</p>;

  const byDate = {};
  events.forEach((e) => {
    const day = new Date(e.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!byDate[day]) byDate[day] = [];
    byDate[day].push(e);
  });

  return (
    <div className={styles.fixtures}>
      {Object.entries(byDate).map(([day, dayEvents]) => (
        <div key={day}>
          <div className={styles.fixtureDay}>{day}</div>
          {dayEvents.map((event) => (
            <FixtureRow key={event.id} event={event} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FixtureRow({ event }) {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((c) => c.homeAway === "home");
  const away = competition?.competitors?.find((c) => c.homeAway === "away");
  const status = competition?.status;
  const isLive = status?.type?.state === "in";
  const isFinished = status?.type?.completed;

  const homeEntry = findEntry(home?.team?.displayName);
  const awayEntry = findEntry(away?.team?.displayName);

  const venue = competition?.venue;
  const venueName = venue?.fullName;
  const venueCity = venue?.address?.city;
  const venueStr = venueName
    ? (venueCity ? `${venueName}, ${venueCity}` : venueName)
    : null;

  const referee = competition?.officials?.find(
    (o) => o.position?.displayName?.toLowerCase().includes("referee")
  )?.fullName ?? null;

  const metaParts = [];
  if (venueStr) metaParts.push(venueStr);
  if (referee) metaParts.push(`Ref: ${referee}`);

  return (
    <div className={`${styles.fixtureRow} ${isLive ? styles.live : ""}`}>
      <div className={styles.fixtureDate}>
        {isLive ? (
          <span className={styles.liveDot}>LIVE {status?.displayClock}</span>
        ) : (
          formatDate(event.date)
        )}
      </div>
      <div className={styles.fixtureTeams}>
        <TeamSlot entry={homeEntry} team={home?.team} score={home?.score} />
        <div className={styles.vs}>
          {isFinished || isLive ? (
            <span className={styles.score}>{home?.score} – {away?.score}</span>
          ) : (
            <span className={styles.vsText}>vs</span>
          )}
        </div>
        <TeamSlot entry={awayEntry} team={away?.team} score={away?.score} right />
      </div>
      {(competition?.groups?.name || metaParts.length > 0) && (
        <div className={styles.fixtureGroup}>
          {competition?.groups?.name}
          {metaParts.length > 0 && (
            <span className={styles.fixtureMeta}>{competition?.groups?.name ? " · " : ""}{metaParts.join(" · ")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSlot({ entry, team, right }) {
  const name = team?.displayName ?? team?.shortDisplayName ?? "";
  return (
    <div className={`${styles.teamSlot} ${right ? styles.right : ""}`}>
      {!right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
      <div className={styles.slotInfo}>
        <span className={styles.slotName}>{name}</span>
        {entry?.person && <span className={styles.slotOwner}>{entry.person}</span>}
      </div>
      {right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
    </div>
  );
}

function resolveSlot(label, qualifiers) {
  const { winners, runnersUp, allThirds, best8thirds, completedGroups, guaranteedWinners, guaranteedRunnersUp } = qualifiers;
  const winM = label.match(/^Winner Group ([A-L])$/);
  if (winM) {
    const letter = winM[1];
    const team = winners[letter] || null;
    return { label, team, guaranteed: completedGroups.has(letter) || (team ? guaranteedWinners.has(team) : false) };
  }
  const runM = label.match(/^Runner-up Group ([A-L])$/);
  if (runM) {
    const letter = runM[1];
    const team = runnersUp[letter] || null;
    return { label, team, guaranteed: completedGroups.has(letter) || (team ? guaranteedRunnersUp.has(team) : false) };
  }
  if (label.startsWith("Best 3rd")) {
    const groupMatch = label.match(/Best 3rd ([A-L/]+)/);
    if (groupMatch && allThirds.length > 0) {
      const eligible = new Set(groupMatch[1].split("/"));
      const best8set = new Set(best8thirds);
      const allGroupsDone = completedGroups.size >= 12;
      // Best qualifying third from eligible groups (in top-8 rank order)
      const candidate = allThirds.find((t) => eligible.has(t.group) && best8set.has(t.name));
      if (candidate) return { label, team: candidate.name, tentative: best8thirds.length < 8 || !allGroupsDone, guaranteed: allGroupsDone };
      // Fallback: best third from eligible groups even if outside top 8 yet
      const fallback = allThirds.find((t) => eligible.has(t.group));
      if (fallback) return { label, team: fallback.name, tentative: true };
    }
    return { label, team: null };
  }
  return { label, team: null };
}

function ThirdPlaceTable({ allThirds, best8thirds }) {
  if (allThirds.length === 0) return null;
  const best8 = new Set(best8thirds);
  return (
    <div className={styles.thirdsTable}>
      <h3 className={styles.bracketRoundTitle}>Best 3rd-Place Rankings</h3>
      <p className={styles.thirdsNote}>Top 8 qualify for Round of 32 · Ranked by Pts → GD → GF</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.teamCol}>Team</th>
            <th>Grp</th>
            <th>P</th>
            <th>GD</th>
            <th>GF</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {allThirds.map((t, i) => {
            const entry = findEntry(t.name);
            const qualifying = best8.has(t.name);
            return (
              <tr key={t.name} className={qualifying ? styles.qualifyingRow : styles.eliminatedRow}>
                <td className={styles.teamCell}>
                  <span className={styles.thirdsRank}>{i + 1}</span>
                  {entry && <Flag code={entry.flag} size={18} />}
                  <span className={styles.espnTeamName}>{t.name}</span>
                  {qualifying && i < 8 && <span className={styles.qualifyBadge}>Q</span>}
                </td>
                <td>{t.group}</td>
                <td>{t.played}</td>
                <td>{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
                <td>{t.gf}</td>
                <td><strong>{t.points}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BracketTab({ knockoutEvents, qualifiers }) {
  if (knockoutEvents.length > 0) {
    const byRound = {};
    knockoutEvents.forEach((e) => {
      const round = e.competitions?.[0]?.groups?.name ?? "Unknown";
      if (!byRound[round]) byRound[round] = [];
      byRound[round].push(e);
    });
    return (
      <div className={styles.bracket}>
        {Object.entries(byRound).map(([round, events]) => (
          <div key={round} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{round}</h3>
            <div className={styles.bracketMatches}>
              {events.map((event) => (
                <FixtureRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Resolve all R32 slots up front, then deduplicate "Best 3rd" team assignments.
  // Multiple slot labels share group letters (e.g. both A/B/C/D/F and B/E/F/I/J
  // include B), so without deduplication the same team can appear twice.
  const usedBest3rd = new Set();
  const resolvedMatches = R32_SCHEDULE.map((m) => {
    let home = resolveSlot(m.home, qualifiers);
    let away = resolveSlot(m.away, qualifiers);
    if (m.home.startsWith("Best 3rd") && home.team) {
      if (usedBest3rd.has(home.team)) home = { ...home, team: null };
      else usedBest3rd.add(home.team);
    }
    if (m.away.startsWith("Best 3rd") && away.team) {
      if (usedBest3rd.has(away.team)) away = { ...away, team: null };
      else usedBest3rd.add(away.team);
    }
    return { m, home, away };
  });

  return (
    <div className={styles.bracket}>
      <div className={styles.bracketBanner}>
        <span>Group stage ends ~26 Jun · Knockout stage begins 28 Jun · <strong>*</strong> = provisional based on current standings</span>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Round of 32</h3>
        <div className={styles.bracketMatches}>
          {resolvedMatches.map(({ m, home, away }) => {
            const homeEntry = home.team ? findEntry(home.team) : null;
            const awayEntry = away.team ? findEntry(away.team) : null;
            return (
              <div key={`${m.date}-${m.home}`} className={styles.staticMatch}>
                <div className={styles.staticMeta}>{m.date} · {m.venue}</div>
                <div className={styles.staticTeams}>
                  <div className={styles.staticSlot}>
                    {homeEntry && <Flag code={homeEntry.flag} size={18} />}
                    <div>
                      <div className={`${styles.staticTeam} ${home.guaranteed ? styles.staticTeamConfirmed : ""}`}>{home.team || home.label}{home.tentative ? <span className={styles.tentative}> *</span> : null}</div>
                      {home.team && <div className={styles.staticSub}>{home.label}</div>}
                      {homeEntry?.person && <div className={styles.staticOwner}>{homeEntry.person}</div>}
                    </div>
                  </div>
                  <span className={styles.staticVs}>vs</span>
                  <div className={`${styles.staticSlot} ${styles.staticSlotRight}`}>
                    <div style={{ textAlign: "right" }}>
                      <div className={`${styles.staticTeam} ${away.guaranteed ? styles.staticTeamConfirmed : ""}`}>{away.team || away.label}{away.tentative ? <span className={styles.tentative}> *</span> : null}</div>
                      {away.team && <div className={styles.staticSub}>{away.label}</div>}
                      {awayEntry?.person && <div className={styles.staticOwner}>{awayEntry.person}</div>}
                    </div>
                    {awayEntry && <Flag code={awayEntry.flag} size={18} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ThirdPlaceTable allThirds={qualifiers.allThirds} best8thirds={qualifiers.best8thirds} />

      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Round of 16 · 4–7 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Round of 32</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Quarter-finals · 9–11 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Round of 16</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Semi-finals · 14–15 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Quarter-finals</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Final · 19 Jul · MetLife Stadium</h3>
        <p className={styles.bracketTbd}>Teams determined after Semi-finals</p>
      </div>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
