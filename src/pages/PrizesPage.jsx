import { useState, useEffect } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { runSimulations, GROUPS, GROUP_SCHEDULE } from "../utils/monteCarlo";
import { getCached, setCache, TTL } from "../utils/cache";
import { fetchCurrentOdds, getCachedOddsAge } from "../utils/oddsApi";
import styles from "./PrizesPage.module.css";

const PRIZES = [
  { name: "Winner",                              amount: 200, top: true },
  { name: "Runner-up",                           amount: 80,  top: true },
  { name: "Third Place",                         amount: 40,  top: true },
  { name: "Player of the Tournament",            amount: 40  },
  { name: "Goal of the Tournament",              amount: 40,  currentKey: "gott" },
  { name: "Worst Team Overall",                  amount: 20,  currentKey: "worstOverall" },
  { name: "Worst Team to exit Group Stage",      amount: 20,  currentKey: "worstGroup" },
  { name: "Worst Team to reach Last 16",         amount: 20,  currentKey: "worstL16" },
  { name: "Worst Team to reach Quarter-Finals",  amount: 20,  currentKey: "worstQF" },
];

const PRIZE_LABELS = {
  winner:      'Tournament winner',
  runnerUp:    'Runner-up',
  third:       'Third place',
  pott:        'Player of Tournament',
  gott:        'Goal of Tournament',
  worstGroup:  'Worst to exit groups',
  worstL16:    'Worst to reach L16',
  worstQF:     'Worst to reach QFs',
  worstOverall:'Worst team overall',
};

const TOTAL = PRIZES.reduce((s, p) => s + p.amount, 0);

const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";
const CACHE_KEY = "espn_standings";

// R32 starts June 28 (group stage ended June 26), so this date window contains
// only knockout events — no group stage filtering needed. Ending +14 days
// ensures the window always covers the latest completed results.
function knockoutScoreboardUrl() {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=100&dates=20260628-${fmt(Date.now() + 14 * 864e5)}`;
}

// Fetch knockout events from the single knockout-only scoreboard window, cached per-day.
async function fetchKnockoutEvents() {
  const cacheKey = `espn_ko_v5_${new Date().toISOString().slice(0, 10)}`;
  const cached = getCached(cacheKey, TTL.SCORES);
  if (cached) return cached;
  const res = await fetch(knockoutScoreboardUrl());
  if (!res.ok) return [];
  const data = await res.json();
  const events = data.events ?? [];
  setCache(cacheKey, events);
  return events;
}

// Builds pair→winner map from completed knockout events — no round-name parsing needed.
// Key: sorted "teama|teamb" (lowercase internal names). Value: winner (lowercase internal name).
function buildKnockoutResults(events) {
  const results = {};
  for (const event of events ?? []) {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === "home");
    const away = comp?.competitors?.find(c => c.homeAway === "away");
    if (!home || !away) continue;
    // Winner flag only — safe for matches that go to ET/pens (level at 90 mins).
    const winnerDisplay = home.winner === true ? home.team?.displayName
      : away.winner === true ? away.team?.displayName
      : null;
    if (!winnerDisplay) continue; // not finished yet
    const homeR = resolveEspnTeam(home.team?.displayName ?? "");
    const awayR = resolveEspnTeam(away.team?.displayName ?? "");
    const winR  = resolveEspnTeam(winnerDisplay);
    if (!homeR || !awayR || !winR) continue;
    const pairKey = [homeR.toLowerCase(), awayR.toLowerCase()].sort().join("|");
    results[pairKey] = winR.toLowerCase();
  }
  return results;
}

// Classify each knockout result by round using win-count heuristic:
// R32 winner appears in values once (loser never), R16 winner twice, etc.
// For pair [A,B]: min(winCount[A], winCount[B]) → 0=R32, 1=R16, 2=QF, 3=SF
function computeRoundWinners(knockoutResults) {
  const winCount = {};
  for (const w of Object.values(knockoutResults)) {
    winCount[w] = (winCount[w] ?? 0) + 1;
  }
  const r32 = new Set(), r16 = new Set(), qf = new Set(), sf = new Set();
  for (const [pairKey, winner] of Object.entries(knockoutResults)) {
    const [a, b] = pairKey.split('|');
    const minWins = Math.min(winCount[a] ?? 0, winCount[b] ?? 0);
    if      (minWins === 0) r32.add(winner);
    else if (minWins === 1) r16.add(winner);
    else if (minWins === 2) qf.add(winner);
    else if (minWins === 3) sf.add(winner);
  }
  return { r32, r16, qf, sf };
}

function computeWorstKnockoutTeam(winners) {
  let worst = null;
  for (const teamLower of winners) {
    const entry = drawLookup[teamLower];
    if (entry && (!worst || entry.odds > worst.odds)) worst = entry;
  }
  return worst;
}

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

const drawLookup = {};
draw.forEach(e => { drawLookup[e.team.toLowerCase()] = e; });

function resolveEspnTeam(espnName) {
  const lower = espnName.toLowerCase();
  const key = ESPN_ALIASES[lower] ?? lower;
  if (drawLookup[key]) return drawLookup[key].team;
  for (const [k, v] of Object.entries(drawLookup)) {
    if (key.includes(k) || k.includes(key)) return v.team;
  }
  return null;
}

function computeWorstTeam(standings) {
  const groups = standings?.children ?? standings?.standings?.groups ?? [];
  let worst = null;
  for (const group of groups) {
    const entries = group.standings?.entries ?? [];
    const getStats = e => Object.fromEntries((e.stats ?? []).map(s => [s.name, s.value]));
    for (const entry of entries) {
      const st = getStats(entry);
      if ((st.gamesPlayed ?? 0) === 0) continue;
      const teamName = resolveEspnTeam(entry.team?.displayName ?? "");
      if (!teamName) continue;
      const pts = st.points ?? 0;
      const gd = st.pointDifferential ?? 0;
      if (!worst || pts < worst.pts || (pts === worst.pts && gd < worst.gd)) {
        worst = { teamName, pts, gd };
      }
    }
  }
  return worst ? (drawLookup[worst.teamName.toLowerCase()] ?? null) : null;
}

// A team is guaranteed top 2 if at most 1 other team can possibly reach or
// exceed their current points (worst case: they lose all remaining games).
// Conservative: doesn't use H2H, so may miss borderline cases, but never
// shows a team as qualified when they aren't.
function computeGuaranteedQualifiers(standings) {
  const groups = standings?.children ?? standings?.standings?.groups ?? [];
  const getStats = e => Object.fromEntries((e.stats ?? []).map(s => [s.name, s.value]));
  const guaranteed = new Set();
  for (const group of groups) {
    const entries = group.standings?.entries ?? [];
    if (entries.length < 4) continue;
    for (const entry of entries) {
      const st = getStats(entry);
      if ((st.gamesPlayed ?? 0) === 0) continue;
      const myPts = st.points ?? 0;
      const canBeat = entries.filter(other => {
        if (other === entry) return false;
        const ost = getStats(other);
        return (ost.points ?? 0) + 3 * (3 - (ost.gamesPlayed ?? 0)) >= myPts;
      }).length;
      if (canBeat <= 1) {
        const teamName = resolveEspnTeam(entry.team?.displayName ?? "");
        if (teamName) guaranteed.add(teamName);
      }
    }
  }
  return guaranteed;
}

function isGroupStageComplete(standings) {
  const groups = standings?.children ?? standings?.standings?.groups ?? [];
  const getStats = e => Object.fromEntries((e.stats ?? []).map(s => [s.name, s.value]));
  let done = 0;
  for (const group of groups) {
    const entries = group.standings?.entries ?? [];
    if (!entries.length) continue;
    const maxPlayed = Math.max(...entries.map(e => getStats(e).gamesPlayed ?? 0));
    if (maxPlayed >= 3) done++;
  }
  return done >= 12;
}

function computeWorstQualified(standings) {
  const guaranteed = computeGuaranteedQualifiers(standings);
  let worst = null;
  for (const teamName of guaranteed) {
    const drawEntry = drawLookup[teamName.toLowerCase()];
    if (!drawEntry) continue;
    if (!worst || drawEntry.odds > worst.odds) worst = drawEntry;
  }
  return worst;
}

// Uses GROUP_SCHEDULE + current standings to infer which teams are H2H-locked out of top 2.
// Only fires for teams whose pts are unambiguous: 0pts (lost all) or maxPts (won all).
// A team is eliminated if 2+ opponents both (a) beat them on H2H and (b) already have
// points >= the team's theoretical maximum.
function computeEliminatedTeams(overrideTeams, letter, matchdaysPlayed) {
  const groupNames = GROUPS[letter];
  if (!groupNames || matchdaysPlayed === 0) return new Set();

  const teamByName = Object.fromEntries(overrideTeams.map(t => [t.teamName, t]));
  const maxPlayedPts = 3 * matchdaysPlayed;

  // Build set of "A definitely beat B" relationships from unambiguous results.
  const definitelyBeat = new Set();
  for (let md = 0; md < matchdaysPlayed; md++) {
    for (const [aIdx, bIdx] of GROUP_SCHEDULE[md]) {
      const aName = groupNames[aIdx], bName = groupNames[bIdx];
      const a = teamByName[aName], b = teamByName[bName];
      if (!a || !b) continue;
      if (b.pts === 0)          definitelyBeat.add(`${aName}:${bName}`); // b lost all games
      if (a.pts === 0)          definitelyBeat.add(`${bName}:${aName}`); // a lost all games
      if (a.pts === maxPlayedPts) definitelyBeat.add(`${aName}:${bName}`); // a won all games
      if (b.pts === maxPlayedPts) definitelyBeat.add(`${bName}:${aName}`); // b won all games
    }
  }

  const eliminated = new Set();
  for (const team of overrideTeams) {
    const maxPts = team.pts + 3 * (3 - matchdaysPlayed);
    let definitelyAbove = 0;
    for (const opp of overrideTeams) {
      if (opp === team) continue;
      // Strictly above: opp already has more pts than team can ever reach — no H2H needed.
      // Tied: opp could finish level with team's max, but H2H win means opp always places higher.
      const strictlyAbove = opp.pts > maxPts;
      const tiedWithHth   = opp.pts === maxPts && definitelyBeat.has(`${opp.teamName}:${team.teamName}`);
      if (strictlyAbove || tiedWithHth) definitelyAbove++;
    }
    if (definitelyAbove >= 2) eliminated.add(team.teamName);
  }
  return eliminated;
}

function buildGroupOverrides(standings) {
  const overrides = {};
  const groups = standings?.children ?? standings?.standings?.groups ?? [];
  for (const group of groups) {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter || letter.length > 1) continue;
    const entries = group.standings?.entries ?? [];
    const getStats = e => Object.fromEntries((e.stats ?? []).map(s => [s.name, s.value]));
    const gamesPlayedArr = entries.map(e => getStats(e).gamesPlayed ?? 0);
    const minPlayed = Math.min(...gamesPlayedArr);
    const maxPlayed = Math.max(...gamesPlayedArr);
    if (maxPlayed === 0) continue;
    // complete when any team has played 3 games — prevents re-simulating
    // already-played MD3 games for teams that are genuinely eliminated.
    const complete = maxPlayed >= 3;
    const sorted = [...entries].sort((a, b) => {
      const sa = getStats(a), sb = getStats(b);
      // Prefer ESPN's authoritative intra-group rank (applies the full FIFA tiebreaker
      // chain, including head-to-head). Fall back to pts → GD → GF when rank is absent
      // (e.g. mid-matchday), which can otherwise mis-order teams tied on GD+GF.
      if (sa.rank != null && sb.rank != null && sa.rank !== sb.rank) return sa.rank - sb.rank;
      return (sb.points??0)-(sa.points??0) || (sb.pointDifferential??0)-(sa.pointDifferential??0) || (sb.pointsFor??0)-(sa.pointsFor??0);
    });
    const teams = sorted.map(e => {
      const teamName = resolveEspnTeam(e.team?.displayName ?? "");
      if (!teamName) return null;
      const st = getStats(e);
      return { teamName, pts: st.points ?? 0, gd: st.pointDifferential ?? 0, gf: st.pointsFor ?? 0 };
    }).filter(Boolean);
    const eliminatedTeams = complete ? new Set() : computeEliminatedTeams(teams, letter, minPlayed);
    if (teams.length === 4) overrides[letter] = { teams, complete, matchdaysPlayed: minPlayed, eliminatedTeams };
  }
  return overrides;
}

const byPerson = {};
draw.forEach(e => {
  const k = e.person ?? "Unclaimed";
  if (!byPerson[k]) byPerson[k] = [];
  byPerson[k].push(e);
});

// Hardcoded current holders (manually updated)
const MANUAL_CURRENT = {
  gott: { entry: draw.find(t => t.team === "France"), quality: 0.9, perGameProb: 0.03 },
};

export default function PrizesPage() {
  const [results, setResults]       = useState(null);
  const [running, setRunning]       = useState(false);
  const [lockedCount, setLockedCount] = useState(null);
  const [r32LockedCount, setR32LockedCount] = useState(0);
  const [expanded, setExpanded]     = useState(null);
  const [worstTeam, setWorstTeam]           = useState(null);
  const [worstQualified, setWorstQualified] = useState(null);
  const [worstL16Entry, setWorstL16Entry]   = useState(null);
  const [worstQFEntry, setWorstQFEntry]     = useState(null);
  const [groupsComplete, setGroupsComplete] = useState(false);
  const [koResultsCache, setKoResultsCache] = useState({});
  const [standingsRef, setStandingsRef] = useState(null);
  const [currentOdds, setCurrentOdds] = useState(null);
  const [oddsAge, setOddsAge]       = useState(null);

  useEffect(() => {
    async function load() {
      try {
        let s = getCached(CACHE_KEY, TTL.STANDINGS);
        if (!s) {
          const res = await fetch(ESPN_STANDINGS);
          if (res.ok) { s = await res.json(); setCache(CACHE_KEY, s); }
        }
        if (s) {
          setStandingsRef(s);
          setWorstTeam(computeWorstTeam(s));
          setWorstQualified(computeWorstQualified(s));
          setGroupsComplete(isGroupStageComplete(s));
        }
      } catch {}
      try {
        const koEvents = await fetchKnockoutEvents();
        if (koEvents.length) {
          const koResults = buildKnockoutResults(koEvents);
          setKoResultsCache(koResults);
          const { r32, r16 } = computeRoundWinners(koResults);
          const worstR32 = r32.size > 0 ? computeWorstKnockoutTeam(r32) : null;
          const worstR16 = r16.size > 0 ? computeWorstKnockoutTeam(r16) : null;
          setWorstL16Entry(worstR32 ? { ...worstR32, confirmed: r32.size >= 16 } : null);
          setWorstQFEntry(worstR16  ? { ...worstR16,  confirmed: r16.size >= 8  } : null);
        }
      } catch {}
      try {
        const odds = await fetchCurrentOdds();
        setCurrentOdds(odds);
        setOddsAge(getCachedOddsAge());
      } catch {}
    }
    load();
  }, []);

  const currently = {
    gott:         MANUAL_CURRENT.gott?.entry,
    worstOverall: worstTeam      ? { ...worstTeam,      confirmed: groupsComplete } : null,
    worstGroup:   worstQualified ? { ...worstQualified, confirmed: groupsComplete } : null,
    worstL16:     worstL16Entry,
    worstQF:      worstQFEntry,
  };

  async function runSim() {
    setRunning(true);
    setExpanded(null);
    let groupOverrides = {};
    let knockoutResults = koResultsCache;
    try {
      let s = standingsRef ?? getCached(CACHE_KEY, TTL.STANDINGS);
      if (!s) {
        const res = await fetch(ESPN_STANDINGS);
        if (res.ok) { s = await res.json(); setCache(CACHE_KEY, s); }
      }
      if (s) {
        groupOverrides = buildGroupOverrides(s);
        setLockedCount(Object.keys(groupOverrides).length);
      }
    } catch {}
    try {
      const koEvents = await fetchKnockoutEvents();
      if (koEvents.length) {
        knockoutResults = buildKnockoutResults(koEvents);
        setKoResultsCache(knockoutResults);
        const { r32, r16 } = computeRoundWinners(knockoutResults);
        const worstR32 = r32.size >= 16 ? computeWorstKnockoutTeam(r32) : null;
        const worstR16 = r16.size >= 8  ? computeWorstKnockoutTeam(r16) : null;
        setWorstL16Entry(worstR32 ? { ...worstR32, confirmed: true } : null);
        setWorstQFEntry(worstR16  ? { ...worstR16,  confirmed: true } : null);
        setR32LockedCount(Object.keys(knockoutResults).length);
      }
    } catch {}
    setTimeout(() => {
      const gottEntry = MANUAL_CURRENT.gott;
      const gottConfig = gottEntry ? { teamName: gottEntry.entry.team, quality: gottEntry.quality, perGameProb: gottEntry.perGameProb } : null;
      const result = runSimulations(10000, groupOverrides, gottConfig, currentOdds, knockoutResults);
      setResults(result);
      setRunning(false);
    }, 10);
  }

  const fairShare = TOTAL / Object.keys(byPerson).length;

  const ranked = results
    ? Object.entries(results.personEV)
        .sort(([,a],[,b]) => b-a)
        .map(([name, ev], i) => ({ rank: i+1, name, ev }))
    : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Prize Money</h1>
      <div className={styles.list}>
        {PRIZES.map((p, i) => {
          const curr = p.currentKey ? currently[p.currentKey] : null;
          return (
            <div key={p.name} className={`${styles.row} ${p.top ? styles.top : ""}`}>
              {p.top && <div className={styles.medal}>{i===0?"🥇":i===1?"🥈":"🥉"}</div>}
              {!p.top && <div className={styles.icon}>🏆</div>}
              <div className={styles.nameBlock}>
                <span className={styles.name}>{p.name}</span>
                {curr && (
                  <span className={curr.confirmed ? styles.confirmed : styles.currently}>
                    {curr.confirmed ? 'Confirmed: ' : 'Currently: '}
                    <Flag code={curr.flag} size={13} />
                    {curr.team}
                    {curr.person && <span className={styles.currentlyOwner}> · {curr.person}</span>}
                  </span>
                )}
              </div>
              <span className={styles.amount}>£{p.amount}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.total}>
        <span className={styles.totalLabel}>Total prize pot</span>
        <span className={styles.totalAmount}>£{TOTAL}</span>
      </div>

      <div className={styles.simSection}>
        <div className={styles.simHeader}>
          <div>
            <h2 className={styles.simTitle}>Expected Value Calculator</h2>
            <p className={styles.simDesc}>
              Simulates 10,000 tournaments using {currentOdds
                ? <>current bookmaker odds{oddsAge !== null ? ` (updated ${Math.round(oddsAge / 60000)}m ago)` : ''}</>
                : 'pre-tournament odds'
              }. Pulls live standings — completed groups are locked in, the rest are simulated.
            </p>
          </div>
          <button className={styles.simBtn} onClick={runSim} disabled={running}>
            {running ? "Running…" : results ? "Re-run" : "Run simulation"}
          </button>
        </div>

        {ranked && (
          <>
            {lockedCount !== null && lockedCount > 0 && (
              <div className={styles.evMeta}>
                <span className={styles.evLocked}>Live standings used for {lockedCount}/12 groups</span>
              </div>
            )}
            {r32LockedCount > 0 && (
              <div className={styles.evMeta}>
                <span className={styles.evLocked}>{r32LockedCount} knockout result{r32LockedCount !== 1 ? 's' : ''} locked in</span>
              </div>
            )}
            <div className={styles.evTable}>
              {ranked.map(({ rank, name, ev }) => {
                const teams = (byPerson[name] ?? []).sort((a,b) => a.odds-b.odds);
                const above = ev >= fairShare;
                const isOpen = expanded === name;
                const breakdown = results.personBreakdown[name] ?? {};
                return (
                  <div key={name} className={`${styles.evCard} ${above ? styles.evAbove : ""}`}>
                    <div
                      className={styles.evRow}
                      onClick={() => setExpanded(isOpen ? null : name)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key==='Enter' && setExpanded(isOpen ? null : name)}
                    >
                      <span className={styles.evRank}>{rank}</span>
                      <div className={styles.evPerson}>
                        <span className={styles.evName}>{name}</span>
                        <div className={styles.evTeams}>
                          {teams.map(t => (
                            <span key={t.team} className={styles.evTeam}>
                              <Flag code={t.flag} size={14} />
                              {t.team}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className={styles.evRight}>
                        <span className={`${styles.evAmount} ${above ? styles.evAmountGold : ""}`}>
                          £{ev.toFixed(2)}
                        </span>
                        <span className={styles.evChevron}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div className={styles.evBreakdown}>
                        {Object.entries(PRIZE_LABELS).map(([key, label]) => {
                          const val = breakdown[key] ?? 0;
                          if (val < 0.01) return null;
                          const teamSplit = results.personBreakdownTeam?.[name]?.[key];
                          const splitEntries = teams.length > 1 && teamSplit
                            ? Object.entries(teamSplit).sort(([,a],[,b]) => b-a)
                            : null;
                          return (
                            <div key={key} className={styles.evBreakdownRow}>
                              <div className={styles.evBreakdownLeft}>
                                <span className={styles.evBreakdownLabel}>{label}</span>
                                {splitEntries && (
                                  <span className={styles.evBreakdownSplit}>
                                    ({splitEntries.map(([t, v], i) => (
                                      <span key={t}>
                                        <Flag code={drawLookup[t.toLowerCase()]?.flag} size={11} />
                                        £{v.toFixed(2)}
                                        {i < splitEntries.length - 1 ? " · " : ""}
                                      </span>
                                    ))})
                                  </span>
                                )}
                              </div>
                              <span className={styles.evBreakdownVal}>£{val.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
