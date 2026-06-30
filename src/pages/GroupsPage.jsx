import { useEffect, useState } from "react";
import { draw } from "../data/draw";
import { GROUPS } from "../utils/monteCarlo";
import Flag from "../components/Flag";
import { getCached, setCache, TTL } from "../utils/cache";
import styles from "./GroupsPage.module.css";

// Pre-computed set of within-group team pairs (sorted lowercase, joined by |).
// Any match between two teams in this set is definitively a group stage match.
const GROUP_PAIRS = new Set();
Object.values(GROUPS).forEach(names => {
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      GROUP_PAIRS.add([names[i].toLowerCase(), names[j].toLowerCase()].sort().join('|'));
});

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
const CACHE_KEY_GS_HISTORY = `espn_gs_history_v2_${new Date().toISOString().slice(0, 10)}`;

const ESPN_ALIASES = {
  "czechia": "czech republic",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "türkiye": "turkey",
  "united states": "usa",
  "curaçao": "curacao",
  "congo dr": "dr congo",
  "korea republic": "south korea",
  "cabo verde": "cape verde",
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
    // Prefer ESPN's authoritative intra-group rank (full FIFA tiebreakers incl. head-to-head);
    // fall back to pts → GD → GF when rank is unavailable.
    if (sa.rank != null && sb.rank != null && sa.rank !== sb.rank) return sa.rank - sb.rank;
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

  // Remaining fixtures: accept if groups.name=group-stage OR both teams in the same known group.
  // ESPN doesn't always set groups.name on upcoming events, so the team-membership fallback
  // prevents falsely treating a group as "complete" (which would incorrectly mark all
  // current leaders as guaranteed qualifiers).
  (upcomingEvents ?? []).forEach((event) => {
    const comp = event.competitions?.[0];
    if (comp?.status?.type?.completed) return;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home || !away) return;
    const homeName = home.team?.displayName ?? "";
    const awayName = away.team?.displayName ?? "";
    const homeGroup = teamToGroup[homeName.toLowerCase()];
    const awayGroup = teamToGroup[awayName.toLowerCase()];
    const groupName = comp?.groups?.name ?? "";
    const isGroupStage = groupName === "group-stage" || (homeGroup && homeGroup === awayGroup);
    if (!isGroupStage) return;
    const letter = homeGroup ?? awayGroup;
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
      played: st.gamesPlayed ?? 0,
    };
  });
  if (teams.length === 0) return null;

  const remaining = fixtures.remaining;

  // If we found 0 remaining games but the group isn't actually finished
  // (some team hasn't played all 3 matchdays), our data fetch was incomplete.
  // Return null rather than falsely marking current leaders as guaranteed.
  if (remaining.length === 0 && teams.some((t) => t.played < 3)) return null;

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
  const guaranteedThirds = new Set(), guaranteedFourths = new Set();
  const guaranteedThrough = new Set();
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
        if (positions.size === 1 && positions.has(3)) guaranteedThirds.add(teamName);
        if (positions.size === 1 && positions.has(4)) guaranteedFourths.add(teamName);
        // Guaranteed through = all feasible positions are top-2 (may still be 1st or 2nd)
        if (positions.size > 0 && [...positions].every(p => p <= 2)) guaranteedThrough.add(teamName);
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

  // Confirmed top-8 / confirmed-out for 3rd-place teams (same logic as ThirdPlaceTable)
  const incompleteGroups = 12 - completedGroups.size;
  const thirdConfirmedIn = new Set(), thirdConfirmedOut = new Set();
  allThirds.forEach((t, i) => {
    if (!completedGroups.has(t.group)) return;
    const completedAbove = allThirds.slice(0, i).filter(t2 => completedGroups.has(t2.group)).length;
    if (completedAbove + incompleteGroups <= 7) thirdConfirmedIn.add(t.name);
    if (completedAbove >= 8) thirdConfirmedOut.add(t.name);
  });

  return { winners, runnersUp, allThirds, best8thirds: [...best8], completedGroups, guaranteedWinners, guaranteedRunnersUp, guaranteedThirds, guaranteedFourths, guaranteedThrough, thirdConfirmedIn, thirdConfirmedOut };
}

// R32 in bracket order (pairs of matches that feed into the same R16 game).
// Derived from R16 = [[1,4],[0,2],[3,5],[6,7],[10,11],[8,9],[13,15],[12,14]] in monteCarlo.js.
// Quarter 1 → QF[0] → SF[0]: R32 slots 1,4 then 0,2
// Quarter 2 → QF[1] → SF[0]: R32 slots 10,11 then 8,9
// Quarter 3 → QF[2] → SF[1]: R32 slots 3,5 then 6,7
// Quarter 4 → QF[3] → SF[1]: R32 slots 13,15 then 12,14
const R32_SCHEDULE = [
  // — Quarter 1 —
  { date: "29 Jun", venue: "Foxborough",      home: "Winner Group E",    away: "Best 3rd A/B/C/D/F" },
  { date: "30 Jun", venue: "East Rutherford", home: "Winner Group I",    away: "Best 3rd C/D/F/G/H" },
  { date: "28 Jun", venue: "Inglewood",       home: "Runner-up Group A", away: "Runner-up Group B"   },
  { date: "29 Jun", venue: "Guadalupe",       home: "Winner Group F",    away: "Runner-up Group C"   },
  // — Quarter 2 —
  { date: "2 Jul",  venue: "Toronto",         home: "Runner-up Group K", away: "Runner-up Group L"   },
  { date: "2 Jul",  venue: "Inglewood",       home: "Winner Group H",    away: "Runner-up Group J"   },
  { date: "1 Jul",  venue: "Santa Clara",     home: "Winner Group D",    away: "Best 3rd B/E/F/I/J" },
  { date: "1 Jul",  venue: "Seattle",         home: "Winner Group G",    away: "Best 3rd A/E/H/I/J" },
  // — Quarter 3 —
  { date: "29 Jun", venue: "Houston",         home: "Winner Group C",    away: "Runner-up Group F"   },
  { date: "30 Jun", venue: "Arlington",       home: "Runner-up Group E", away: "Runner-up Group I"   },
  { date: "30 Jun", venue: "Mexico City",     home: "Winner Group A",    away: "Best 3rd C/E/F/H/I" },
  { date: "1 Jul",  venue: "Atlanta",         home: "Winner Group L",    away: "Best 3rd E/H/I/J/K" },
  // — Quarter 4 —
  { date: "3 Jul",  venue: "Miami Gardens",   home: "Winner Group J",    away: "Runner-up Group H"   },
  { date: "3 Jul",  venue: "Arlington",       home: "Runner-up Group D", away: "Runner-up Group G"   },
  { date: "2 Jul",  venue: "Vancouver",       home: "Winner Group B",    away: "Best 3rd E/F/G/I/J" },
  { date: "3 Jul",  venue: "Kansas City",     home: "Winner Group K",    away: "Best 3rd D/E/I/J/L" },
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
  const qualifiers = computeQualifiers(groups, fixtureData);

  const knockoutEvents = events.filter((e) => {
    const groupName = (e.competitions?.[0]?.groups?.name ?? "").toLowerCase().replace(/[\s-]/g, "");
    if (groupName.startsWith("group")) return false;
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === "home");
    const away = comp?.competitors?.find(c => c.homeAway === "away");
    if (!home || !away) return true;
    const hk = normalizeDisplayName(home.team?.displayName ?? "");
    const ak = normalizeDisplayName(away.team?.displayName ?? "");
    if (!hk || !ak) return true;
    return !GROUP_PAIRS.has([hk, ak].sort().join('|'));
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
            <GroupTable
              key={group.uid ?? group.name}
              group={group}
              guaranteedWinners={qualifiers.guaranteedWinners}
              guaranteedThrough={qualifiers.guaranteedThrough}
              guaranteedThirds={qualifiers.guaranteedThirds}
              guaranteedFourths={qualifiers.guaranteedFourths}
              thirdConfirmedIn={qualifiers.thirdConfirmedIn}
              thirdConfirmedOut={qualifiers.thirdConfirmedOut}
            />
          ))}
          {qualifiers.allThirds.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <ThirdPlaceTable allThirds={qualifiers.allThirds} best8thirds={qualifiers.best8thirds} completedGroups={qualifiers.completedGroups} />
            </div>
          )}
        </div>
      )}

      {tab === "fixtures" && (
        <FixturesTab events={events} loading={!scoreboard} />
      )}

      {tab === "bracket" && (
        <BracketTab knockoutEvents={knockoutEvents} historyEvents={historyEvents ?? []} qualifiers={qualifiers} />
      )}
    </div>
  );
}

function GroupTable({ group, guaranteedWinners = new Set(), guaranteedThrough = new Set(), guaranteedThirds = new Set(), guaranteedFourths = new Set(), thirdConfirmedIn = new Set(), thirdConfirmedOut = new Set() }) {
  const entries = [...(group.standings?.entries ?? [])].sort((a, b) => {
    const sa = Object.fromEntries((a.stats ?? []).map((s) => [s.name, s.value]));
    const sb = Object.fromEntries((b.stats ?? []).map((s) => [s.name, s.value]));
    // Prefer ESPN's authoritative rank (full FIFA tiebreakers); fall back to pts → GD.
    if (sa.rank != null && sb.rank != null && sa.rank !== sb.rank) return sa.rank - sb.rank;
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
            const nameClass = guaranteedWinners.has(teamName)
              ? styles.teamWinner
              : guaranteedThrough.has(teamName)
              ? styles.staticTeamConfirmed
              : thirdConfirmedIn.has(teamName)
              ? styles.staticTeamConfirmed
              : thirdConfirmedOut.has(teamName) || guaranteedFourths.has(teamName)
              ? styles.teamEliminated
              : guaranteedThirds.has(teamName)
              ? styles.teamThird
              : "";
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
                  <span className={`${styles.espnTeamName} ${nameClass}`}>{teamName}</span>
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
        <TeamSlot entry={homeEntry} team={home?.team} score={home?.score} isWinner={home?.winner === true} isLoser={away?.winner === true} />
        <div className={styles.vs}>
          {isFinished || isLive ? (
            <span className={styles.score}>{home?.score} – {away?.score}</span>
          ) : (
            <span className={styles.vsText}>vs</span>
          )}
        </div>
        <TeamSlot entry={awayEntry} team={away?.team} score={away?.score} isWinner={away?.winner === true} isLoser={home?.winner === true} right />
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

function TeamSlot({ entry, team, right, isWinner, isLoser }) {
  const name = team?.displayName ?? team?.shortDisplayName ?? "";
  return (
    <div className={`${styles.teamSlot} ${right ? styles.right : ""}${isLoser ? ` ${styles.teamLoser}` : ""}`}>
      {!right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
      <div className={styles.slotInfo}>
        <span className={`${styles.slotName}${isWinner ? ` ${styles.teamWinner}` : ""}`}>{name}</span>
        {entry?.person && <span className={styles.slotOwner}>{entry.person}</span>}
      </div>
      {right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
    </div>
  );
}

// Bipartite matching: assign each of the top-8 third-place teams to exactly one
// R32 "Best 3rd" slot whose eligible-group set contains that team's group.
// Uses DFS augmenting paths (Kuhn's algorithm) — 8×8 so trivially fast.
function computeBest3rdAssignment(allThirds, best8thirds) {
  const best8set = new Set(best8thirds);
  const top8 = allThirds.filter((t) => best8set.has(t.name)); // preserves rank order
  if (top8.length === 0) return {};

  const seen = new Set();
  const slots = [];
  for (const m of R32_SCHEDULE) {
    for (const label of [m.home, m.away]) {
      if (label.startsWith("Best 3rd") && !seen.has(label)) {
        seen.add(label);
        slots.push({ label, eligible: new Set(label.replace("Best 3rd ", "").split("/")) });
      }
    }
  }

  const ns = slots.length;
  const nt = top8.length;
  const slotToTeam = new Array(ns).fill(-1);
  const teamToSlot = new Array(nt).fill(-1);

  function augment(si, visited) {
    for (let ti = 0; ti < nt; ti++) {
      if (visited[ti] || !slots[si].eligible.has(top8[ti].group)) continue;
      visited[ti] = true;
      if (teamToSlot[ti] === -1 || augment(teamToSlot[ti], visited)) {
        slotToTeam[si] = ti;
        teamToSlot[ti] = si;
        return true;
      }
    }
    return false;
  }

  for (let si = 0; si < ns; si++) {
    augment(si, new Array(nt).fill(false));
  }

  const assignment = {};
  for (let si = 0; si < ns; si++) {
    assignment[slots[si].label] = slotToTeam[si] >= 0 ? top8[slotToTeam[si]].name : null;
  }
  return assignment;
}

function resolveSlot(label, qualifiers, best3rdAssignment = {}) {
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
    const allGroupsDone = completedGroups.size >= 12;
    const team = best3rdAssignment[label] ?? null;
    if (team) return { label, team, tentative: best8thirds.length < 8 || !allGroupsDone, guaranteed: allGroupsDone };
    // Fallback before top-8 is known: show best 3rd from eligible groups
    const groupMatch = label.match(/Best 3rd ([A-L/]+)/);
    if (groupMatch && allThirds.length > 0) {
      const eligible = new Set(groupMatch[1].split("/"));
      const fallback = allThirds.find((t) => eligible.has(t.group));
      if (fallback) return { label, team: fallback.name, tentative: true };
    }
    return { label, team: null };
  }
  return { label, team: null };
}

function ThirdPlaceTable({ allThirds, best8thirds, completedGroups = new Set() }) {
  if (allThirds.length === 0) return null;
  const incompleteGroups = 12 - completedGroups.size;
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
            const groupComplete = completedGroups.has(t.group);
            const completedAbove = allThirds.slice(0, i).filter(t2 => completedGroups.has(t2.group)).length;
            const confirmedIn  = groupComplete && completedAbove + incompleteGroups <= 7;
            const confirmedOut = groupComplete && completedAbove >= 8;
            const rowClass = confirmedIn ? styles.qualifyingRow : confirmedOut ? styles.eliminatedRow : "";
            return (
              <tr key={t.name} className={`${rowClass} ${i === 8 ? styles.cutoffRow : ""}`}>
                <td className={styles.teamCell}>
                  <span className={styles.thirdsRank}>{i + 1}</span>
                  {entry && <Flag code={entry.flag} size={18} />}
                  <span className={styles.espnTeamName}>{t.name}</span>
                  {confirmedIn && <span className={styles.qualifyBadge}>Q</span>}
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

// R16 matchups as pairs of R32_SCHEDULE indices (winners play each other).
// Derived from R16 = [[1,4],[0,2],[3,5],[6,7],[10,11],[8,9],[13,15],[12,14]] in monteCarlo.js
// by translating each slot index to its R32_SCHEDULE position.
const R16_BY_SCHED = [[0,1],[2,3],[8,9],[10,11],[4,5],[6,7],[12,13],[14,15]];
// QF pairs = R16 winner indices (from monteCarlo.js QF = [[0,1],[4,5],[2,3],[6,7]])
const QF_BY_R16 = [[0,1],[4,5],[2,3],[6,7]];

function normalizeDisplayName(name) {
  if (!name) return null;
  const entry = findEntry(name);
  return (entry ? entry.team : name).toLowerCase();
}

// Map a round label string to a bracket tier (0=R32, 1=R16, 2=QF, 3=SF, 4=Final)
function roundNameTier(name) {
  const n = (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("32")) return 0;
  if (n.includes("16")) return 1;
  if (n.includes("quarter")) return 2;
  if (n.includes("semi")) return 3;
  if (n.includes("final")) return 4;
  return -1;
}

function BracketTab({ knockoutEvents, historyEvents = [], qualifiers }) {
  const best3rdAssignment = computeBest3rdAssignment(qualifiers.allThirds, qualifiers.best8thirds);
  // Filter history events to knockout-only.
  // Hard date cutoff: group stage finals were ~02:00 UTC June 28; first R32 game was ~19:00 UTC
  // June 28. Anything before noon UTC June 28 is definitively group stage.
  const KO_CUTOFF_MS = Date.parse("2026-06-28T12:00:00Z");
  const historyKnockout = historyEvents.filter(e => {
    if (Date.parse(e.date) < KO_CUTOFF_MS) return false;
    const groupName = (e.competitions?.[0]?.groups?.name ?? "").toLowerCase().replace(/[\s-]/g, "");
    if (groupName.startsWith("group")) return false;
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === "home");
    const away = comp?.competitors?.find(c => c.homeAway === "away");
    if (!home || !away) return false;
    const hk = normalizeDisplayName(home.team?.displayName ?? "");
    const ak = normalizeDisplayName(away.team?.displayName ?? "");
    if (!hk || !ak) return false;
    return !GROUP_PAIRS.has([hk, ak].sort().join('|'));
  });
  const allKnockoutEvents = [
    ...historyKnockout.filter(h => !knockoutEvents.some(c => c.id === h.id)),
    ...knockoutEvents,
  ];

  if (allKnockoutEvents.length > 0) {
    // Build lookup: sorted pair key → winner display name (from completed events).
    // Use winner flag only (safe for ET/pens) — ESPN doesn't set status.type.completed
    // on knockout events so we can't use that as a completion guard.
    const matchWinners = {};
    allKnockoutEvents.forEach((e) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      if (!home || !away) return;
      const homeName = home.team?.displayName ?? "";
      const awayName = away.team?.displayName ?? "";
      const winner = (home.winner === true) ? homeName
        : (away.winner === true) ? awayName
        : null;
      if (!winner) return;
      const key = [normalizeDisplayName(homeName), normalizeDisplayName(awayName)].sort().join("|");
      matchWinners[key] = winner;
    });

    function pairWinner(a, b) {
      if (!a || !b) return null;
      const key = [normalizeDisplayName(a), normalizeDisplayName(b)].sort().join("|");
      const w = matchWinners[key];
      if (!w) return null;
      const wk = normalizeDisplayName(w);
      return wk === normalizeDisplayName(a) ? a : wk === normalizeDisplayName(b) ? b : null;
    }

    // Resolve all 16 R32 slots to actual teams from current standings
    const resolvedR32 = R32_SCHEDULE.map((m) => ({
      home: resolveSlot(m.home, qualifiers, best3rdAssignment),
      away: resolveSlot(m.away, qualifiers, best3rdAssignment),
    }));

    // R32 slot winners: check matchWinners for each resolved slot pair
    const koAllWinnerKeys = new Set(Object.values(matchWinners).map(normalizeDisplayName).filter(Boolean));
    const slotW = resolvedR32.map(({ home, away }) => {
      const hk = normalizeDisplayName(home.team);
      const ak = normalizeDisplayName(away.team);
      if (hk && koAllWinnerKeys.has(hk)) return home.team;
      if (ak && koAllWinnerKeys.has(ak)) return away.team;
      return null;
    });

    // R16 winners: look up each R16 match's expected pair in matchWinners
    const r16W = R16_BY_SCHED.map(([a, b]) => pairWinner(slotW[a], slotW[b]));
    // QF winners
    const qfW = QF_BY_R16.map(([a, b]) => pairWinner(r16W[a], r16W[b]));
    // SF winners
    const sfW = [[0,1],[2,3]].map(([a, b]) => pairWinner(qfW[a], qfW[b]));

    // Count how many knockout wins each team has (used to determine round).
    // Teams with 0 wins → playing in R32, 1 win → R16, 2 → QF, 3 → SF, 4 → Final.
    // This is more reliable than date-based inference since some R32 matches
    // occur on the same date as projected R16 start dates.
    const winCount = {};
    Object.values(matchWinners).forEach(w => {
      const k = normalizeDisplayName(w);
      if (k) winCount[k] = (winCount[k] ?? 0) + 1;
    });
    const ROUND_LABEL_BY_TIER = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
    // R16 games start July 4; use this to classify TBD-vs-TBD pre-listed R16 slots.
    const R16_CUTOFF_MS = Date.parse("2026-07-04T12:00:00Z");
    function roundLabelFromWins(event) {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      if (home && away) {
        const hk = normalizeDisplayName(home.team?.displayName ?? "");
        const ak = normalizeDisplayName(away.team?.displayName ?? "");
        const hw = winCount[hk] ?? 0;
        const aw = winCount[ak] ?? 0;
        // Use matchWinners (same source as winCount) to detect completed games — more reliable
        // than home.winner===true which can be absent on history-endpoint responses.
        const pairKey = hk && ak ? [hk, ak].sort().join("|") : null;
        const isCompleted = !!(pairKey && matchWinners[pairKey]);
        if (isCompleted) {
          // Loser's win count = round they exited (R32 loser has 0 → "Round of 32").
          return ROUND_LABEL_BY_TIER[Math.min(hw, aw)] ?? "Final";
        }
        const maxW = Math.max(hw, aw);
        if (maxW > 0) {
          // At least one confirmed winner → their win count sets the floor round.
          return ROUND_LABEL_BY_TIER[maxW] ?? "Final";
        }
        // Both TBD (0 wins): check ESPN's placeholder names first — "Round of 32 N Winner"
        // means the team comes from R32, so this game is R16; "Round of 16 N Winner" → QF; etc.
        const tbd = (home.team?.displayName ?? "") + " " + (away.team?.displayName ?? "");
        if (/round of 32/i.test(tbd)) return "Round of 16";
        if (/round of 16/i.test(tbd)) return "Quarter-finals";
        if (/quarter/i.test(tbd)) return "Semi-finals";
        if (/semi/i.test(tbd)) return "Final";
        // Last resort: date-based — R16 slots (July 6-7) are after R16_CUTOFF_MS.
        return Date.parse(event.date) > R16_CUTOFF_MS ? "Round of 16" : "Round of 32";
      }
      return "Knockout Stage";
    }

    // Determine the highest round tier already shown by ESPN
    const byRound = {};
    allKnockoutEvents.forEach((e) => {
      const round = roundLabelFromWins(e);
      if (!byRound[round]) byRound[round] = [];
      byRound[round].push(e);
    });
    const maxTier = Math.max(...Object.keys(byRound).map(roundNameTier).filter(t => t >= 0), -1);

    // bracketSlot: produce display info for a team slot
    function bracketSlot(name, fallback) {
      if (name) return { name, entry: findEntry(name), confirmed: true };
      return { name: fallback, entry: null, confirmed: false };
    }

    // Fallback labels for unknown participants
    function r32SlotFallback(idx) {
      const { home, away } = resolvedR32[idx];
      return `${home.team || home.label} / ${away.team || away.label}`;
    }
    function r16SlotFallback(idx) {
      return slotW[R16_BY_SCHED[idx][0]] && slotW[R16_BY_SCHED[idx][1]]
        ? `${slotW[R16_BY_SCHED[idx][0]]} / ${slotW[R16_BY_SCHED[idx][1]]}`
        : "TBD";
    }
    function qfSlotFallback(idx) {
      return r16W[QF_BY_R16[idx][0]] && r16W[QF_BY_R16[idx][1]]
        ? `${r16W[QF_BY_R16[idx][0]]} / ${r16W[QF_BY_R16[idx][1]]}`
        : "TBD";
    }

    // Future rounds in order; each has a label and its computed matchup pairs
    const FUTURE_ROUNDS = [
      {
        tier: 1, label: "Round of 16 · 4–7 Jul",
        pairs: R16_BY_SCHED.map(([a, b]) => [
          bracketSlot(slotW[a], r32SlotFallback(a)),
          bracketSlot(slotW[b], r32SlotFallback(b)),
        ]),
      },
      {
        tier: 2, label: "Quarter-finals · 9–11 Jul",
        pairs: QF_BY_R16.map(([a, b]) => [
          bracketSlot(r16W[a], r16SlotFallback(a)),
          bracketSlot(r16W[b], r16SlotFallback(b)),
        ]),
      },
      {
        tier: 3, label: "Semi-finals · 14–15 Jul",
        pairs: [[0,1],[2,3]].map(([a, b]) => [
          bracketSlot(qfW[a], qfSlotFallback(a)),
          bracketSlot(qfW[b], qfSlotFallback(b)),
        ]),
      },
      {
        tier: 4, label: "Final · 19 Jul · MetLife Stadium",
        pairs: [[bracketSlot(sfW[0], "TBD"), bracketSlot(sfW[1], "TBD")]],
      },
    ];

    function renderFutureMatch(teamA, teamB, key) {
      return (
        <div key={key} className={styles.staticMatch}>
          <div className={styles.staticTeams}>
            <div className={styles.staticSlot}>
              {teamA.entry && <Flag code={teamA.entry.flag} size={18} />}
              <div>
                <div className={`${styles.staticTeam} ${teamA.confirmed ? styles.staticTeamConfirmed : ""}`}>{teamA.name}</div>
                {teamA.entry?.person && <div className={styles.staticOwner}>{teamA.entry.person}</div>}
              </div>
            </div>
            <span className={styles.staticVs}>vs</span>
            <div className={`${styles.staticSlot} ${styles.staticSlotRight}`}>
              <div style={{ textAlign: "right" }}>
                <div className={`${styles.staticTeam} ${teamB.confirmed ? styles.staticTeamConfirmed : ""}`}>{teamB.name}</div>
                {teamB.entry?.person && <div className={styles.staticOwner}>{teamB.entry.person}</div>}
              </div>
              {teamB.entry && <Flag code={teamB.entry.flag} size={18} />}
            </div>
          </div>
        </div>
      );
    }

    const futureToShow = FUTURE_ROUNDS.filter(r => r.tier > maxTier);

    return (
      <div className={styles.bracket}>
        {Object.entries(byRound)
          .sort(([a], [b]) => roundNameTier(a) - roundNameTier(b))
          .map(([round, events]) => (
          <div key={round} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{round}</h3>
            <div className={styles.bracketMatches}>
              {events.map((event) => <FixtureRow key={event.id} event={event} />)}
            </div>
          </div>
        ))}
        {futureToShow.map((r, idx) => (
          <div key={r.tier} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{r.label}</h3>
            {idx === 0
              ? <div className={styles.bracketMatches}>
                  {r.pairs.map(([teamA, teamB], i) => renderFutureMatch(teamA, teamB, i))}
                </div>
              : <p className={styles.bracketTbd}>Teams determined after {futureToShow[idx - 1].label.split(" ·")[0]}</p>
            }
          </div>
        ))}
      </div>
    );
  }

  const resolvedMatches = R32_SCHEDULE.map((m) => ({
    m,
    home: resolveSlot(m.home, qualifiers, best3rdAssignment),
    away: resolveSlot(m.away, qualifiers, best3rdAssignment),
  }));

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
