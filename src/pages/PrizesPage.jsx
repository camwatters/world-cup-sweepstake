import { useState, useEffect } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { runSimulations, GROUPS, GROUP_SCHEDULE, R32 } from "../utils/monteCarlo";
import { getCached, setCache, TTL } from "../utils/cache";
import { findEntry, getStats, standingsGroups, homeAway, roundOf, isKnockout, fetchTournamentEvents, ESPN_STANDINGS } from "../utils/espn";
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

const CACHE_KEY = "espn_standings";

async function fetchStandings() {
  const cached = getCached(CACHE_KEY, TTL.STANDINGS);
  if (cached) return cached;
  const res = await fetch(ESPN_STANDINGS);
  if (!res.ok) return null;
  const s = await res.json();
  setCache(CACHE_KEY, s);
  return s;
}

const pairKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");

// Completed knockout result → { pairKey, winner } (lowercase draw names), or null.
function parseResult(event) {
  if (!isKnockout(event)) return null;
  const [home, away] = homeAway(event);
  if (!home || !away) return null;
  // ESPN pre-populates future bracket slots as soon as a team advances, so skip anything
  // not started or dated in the future. ESPN does NOT set status.type.completed on
  // knockout events, so the winner flag is the completion signal (safe for ET/pens).
  if (event.competitions?.[0]?.status?.type?.state === "pre") return null;
  const eventMs = Date.parse(event.date);
  if (isNaN(eventMs) || eventMs > Date.now()) return null;
  const winnerDisplay = home.winner === true ? home.team?.displayName
    : away.winner === true ? away.team?.displayName
    : null;
  const homeR = findEntry(home.team?.displayName)?.team;
  const awayR = findEntry(away.team?.displayName)?.team;
  const winR  = findEntry(winnerDisplay)?.team;
  if (!homeR || !awayR || !winR) return null;
  return { pairKey: pairKey(homeR, awayR), winner: winR.toLowerCase() };
}

// Pair→winner map from completed knockout events. Key: sorted "teama|teamb". Value: winner.
function buildKnockoutResults(events) {
  return Object.fromEntries(events.map(parseResult).filter(Boolean).map(r => [r.pairKey, r.winner]));
}

function roundWinners(events, round) {
  return events.filter(e => roundOf(e) === round).map(parseResult).filter(Boolean).map(r => r.winner);
}

// Resolve the real opponent for each of the 8 "Best 3rd" R32 wildcard slots directly from
// ESPN's own fixture list, instead of guessing via the simulator's assignThirds() heuristic.
// That heuristic (fewest-candidates-first) does not reproduce FIFA's actual 3rd-place
// allocation table — verified against live standings it mismatches 5 of 8 wildcard slots
// once groups are complete, which then simulates matches that never happened (e.g. pairing
// two already-eliminated teams against each other) in every single simulation run.
function computeThirdPlaceOverrides(events, groupOverrides) {
  const r32Teams = events
    .filter(e => roundOf(e) === "round-of-32")
    .map(e => homeAway(e).map(c => findEntry(c?.team?.displayName)?.team));
  const overrides = {};
  R32.forEach((slots, i) => {
    const thirdIdx = slots.findIndex(s => s.t === '3');
    if (thirdIdx === -1) return;
    const fixed = slots[1 - thirdIdx];
    const grp = groupOverrides[fixed.g];
    if (!grp?.complete) return;
    const certainName = (fixed.t === 'w' ? grp.teams[0] : grp.teams[1])?.teamName;
    const match = certainName && r32Teams.find(pair => pair.includes(certainName));
    const opp = match?.find(t => t !== certainName);
    if (opp) overrides[i] = opp;
  });
  return overrides;
}

// Draw entry with the longest pre-tournament odds among the given team names.
function worstByOdds(names) {
  let worst = null;
  for (const name of names) {
    const entry = findEntry(name);
    if (entry && (!worst || entry.odds > worst.odds)) worst = entry;
  }
  return worst;
}

function computeWorstTeam(standings) {
  let worst = null;
  for (const group of standingsGroups(standings)) {
    for (const entry of group.standings?.entries ?? []) {
      const st = getStats(entry);
      if ((st.gamesPlayed ?? 0) === 0) continue;
      const drawEntry = findEntry(entry.team?.displayName);
      if (!drawEntry) continue;
      const pts = st.points ?? 0;
      const gd = st.pointDifferential ?? 0;
      if (!worst || pts < worst.pts || (pts === worst.pts && gd < worst.gd)) {
        worst = { drawEntry, pts, gd };
      }
    }
  }
  return worst?.drawEntry ?? null;
}

// A team is guaranteed top 2 if at most 1 other team can possibly reach or
// exceed their current points (worst case: they lose all remaining games).
// Conservative: doesn't use H2H, so may miss borderline cases, but never
// shows a team as qualified when they aren't.
function computeGuaranteedQualifiers(standings) {
  const guaranteed = new Set();
  for (const group of standingsGroups(standings)) {
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
        const teamName = findEntry(entry.team?.displayName)?.team;
        if (teamName) guaranteed.add(teamName);
      }
    }
  }
  return guaranteed;
}

function isGroupStageComplete(standings) {
  let done = 0;
  for (const group of standingsGroups(standings)) {
    const entries = group.standings?.entries ?? [];
    if (!entries.length) continue;
    const maxPlayed = Math.max(...entries.map(e => getStats(e).gamesPlayed ?? 0));
    if (maxPlayed >= 3) done++;
  }
  return done >= 12;
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
  for (const group of standingsGroups(standings)) {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter || letter.length > 1) continue;
    const entries = group.standings?.entries ?? [];
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
      const teamName = findEntry(e.team?.displayName)?.team;
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
[...draw].sort((a, b) => a.odds - b.odds).forEach(e => {
  const k = e.person ?? "Unclaimed";
  if (!byPerson[k]) byPerson[k] = [];
  byPerson[k].push(e);
});

// Hardcoded current holders (manually updated)
const MANUAL_CURRENT = {
  gott: { entry: draw.find(t => t.team === "Cape Verde"), quality: 0.9, perGameProb: 0.03 },
};
if (!MANUAL_CURRENT.gott.entry) console.warn("MANUAL_CURRENT.gott: team not found in draw");

// Loads standings + knockout results: the simulation inputs plus the current prize holders.
async function loadLiveData() {
  const live = { groupOverrides: {}, knockoutResults: {}, thirdPlaceOverrides: {}, holders: {} };
  try {
    const s = await fetchStandings();
    if (s) {
      const groupsComplete = isGroupStageComplete(s);
      const worstTeam = computeWorstTeam(s);
      const worstQualified = worstByOdds(computeGuaranteedQualifiers(s));
      live.holders.worstOverall = worstTeam      ? { ...worstTeam,      confirmed: groupsComplete } : null;
      live.holders.worstGroup   = worstQualified ? { ...worstQualified, confirmed: groupsComplete } : null;
      live.groupOverrides = buildGroupOverrides(s);
    }
  } catch { /* standings unavailable — simulate all groups */ }
  try {
    const events = await fetchTournamentEvents();
    live.knockoutResults = buildKnockoutResults(events);
    const r32 = roundWinners(events, "round-of-32");
    const r16 = roundWinners(events, "round-of-16");
    const worstR32 = worstByOdds(r32);
    const worstR16 = worstByOdds(r16);
    live.holders.worstL16 = worstR32 ? { ...worstR32, confirmed: r32.length >= 16 } : null;
    live.holders.worstQF  = worstR16 ? { ...worstR16, confirmed: r16.length >= 8  } : null;
    live.thirdPlaceOverrides = computeThirdPlaceOverrides(events, live.groupOverrides);
  } catch { /* scoreboard unavailable — simulate all knockouts */ }
  return live;
}

export default function PrizesPage() {
  const [results, setResults]       = useState(null);
  const [running, setRunning]       = useState(false);
  const [expanded, setExpanded]     = useState(null);
  const [live, setLive]             = useState(null);
  const [currentOdds, setCurrentOdds] = useState(null);
  const [oddsAge, setOddsAge]       = useState(null);

  useEffect(() => {
    loadLiveData().then(setLive);
    fetchCurrentOdds().then(odds => {
      setCurrentOdds(odds);
      setOddsAge(getCachedOddsAge());
    }).catch(() => {});
  }, []);

  const currently = { gott: MANUAL_CURRENT.gott.entry, ...live?.holders };
  const lockedCount = live ? Object.keys(live.groupOverrides).length : 0;
  const r32LockedCount = live ? Object.keys(live.knockoutResults).length : 0;

  async function runSim() {
    setRunning(true);
    setExpanded(null);
    const fresh = await loadLiveData();
    setLive(fresh);
    setTimeout(() => {
      const gottEntry = MANUAL_CURRENT.gott;
      const gottConfig = gottEntry ? { teamName: gottEntry.entry?.team, quality: gottEntry.quality, perGameProb: gottEntry.perGameProb } : null;
      try {
        setResults(runSimulations(10000, fresh.groupOverrides, gottConfig, currentOdds, fresh.knockoutResults, fresh.thirdPlaceOverrides));
      } finally {
        setRunning(false);
      }
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
            {lockedCount > 0 && (
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
                const teams = byPerson[name] ?? [];
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
                                        <Flag code={findEntry(t)?.flag} size={11} />
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
