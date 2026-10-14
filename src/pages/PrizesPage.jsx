import { useState, useEffect } from "react";
import T from "../tournament";
import Flag from "../components/Flag";
import { runSimulations, GROUP_SCHEDULE } from "../utils/monteCarlo";
import { GROUP_COUNT, THIRD_SLOTS } from "../utils/bracket";
import { findEntry, getStats, standingsGroups, groupLetter, sortEntries, homeAway, roundOf, isKnockout, isFirstRound, pairKey, fetchTournamentEvents, fetchStandings } from "../utils/espn";
import { fetchCurrentOdds, getCachedOddsAge } from "../utils/oddsApi";
import styles from "./PrizesPage.module.css";

const TOTAL = T.prizes.reduce((s, p) => s + p.amount, 0);

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

// [home, away] draw names for each first-round knockout fixture ESPN has published
function firstRoundFixtures(events) {
  return events.filter(isFirstRound).map(e => homeAway(e).map(c => findEntry(c?.team?.displayName)?.team));
}

// The real opponent in each "Best 3rd" slot, read from ESPN's published fixtures once the
// facing group is complete — preferred over assignThirds()' guess in the simulator.
function computeThirdPlaceOverrides(fixtures, groupOverrides) {
  const overrides = {};
  for (const { i, opponent } of THIRD_SLOTS) {
    const grp = groupOverrides[opponent.groups];
    if (!grp?.complete) continue;
    const certainName = grp.teams[opponent.pos - 1]?.teamName;
    const match = certainName && fixtures.find(pair => pair.includes(certainName));
    const opp = match?.find(t => t !== certainName);
    if (opp) overrides[i] = opp;
  }
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
  return done >= GROUP_COUNT;
}

// Uses GROUP_SCHEDULE + current standings to infer which teams are H2H-locked out of top 2.
// Only fires for teams whose pts are unambiguous: 0pts (lost all) or maxPts (won all).
// A team is eliminated if 2+ opponents both (a) beat them on H2H and (b) already have
// points >= the team's theoretical maximum.
function computeEliminatedTeams(overrideTeams, letter, matchdaysPlayed) {
  const groupNames = T.groups[letter];
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
    const letter = groupLetter(group);
    if (!letter || letter.length > 1) continue;
    const entries = group.standings?.entries ?? [];
    const gamesPlayedArr = entries.map(e => getStats(e).gamesPlayed ?? 0);
    const minPlayed = Math.min(...gamesPlayedArr);
    const maxPlayed = Math.max(...gamesPlayedArr);
    if (maxPlayed === 0) continue;
    // complete when any team has played 3 games — prevents re-simulating
    // already-played MD3 games for teams that are genuinely eliminated.
    const complete = maxPlayed >= 3;
    const teams = sortEntries(entries).map(e => {
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
[...T.draw].sort((a, b) => a.odds - b.odds).forEach(e => {
  const k = e.person ?? "Unclaimed";
  if (!byPerson[k]) byPerson[k] = [];
  byPerson[k].push(e);
});

if (T.gott && !findEntry(T.gott.team)) console.warn(`gott: "${T.gott.team}" not found in draw`);

const holder = (entry, confirmed) => entry ? { ...entry, confirmed } : null;

// Loads standings + knockout results: the simulation inputs plus the current prize holders,
// keyed by prize key.
async function loadLiveData() {
  const live = { groupOverrides: {}, knockoutResults: {}, thirdPlaceOverrides: {}, holders: {} };
  const set = (type, fn) => T.prizes.filter(p => p.type === type).forEach(p => { live.holders[p.key] = fn(p); });
  if (T.gott) set("gott", () => findEntry(T.gott.team));
  const [standings, scoreboard] = await Promise.allSettled([fetchStandings(), fetchTournamentEvents()]);
  const events = scoreboard.status === "fulfilled" ? scoreboard.value : null;
  let qualified = null, groupsComplete = false;
  try {
    if (standings.status === "fulfilled") {
      const s = standings.value;
      groupsComplete = isGroupStageComplete(s);
      set("worstOverall", () => holder(computeWorstTeam(s), groupsComplete));
      qualified = worstByOdds(computeGuaranteedQualifiers(s));
      live.groupOverrides = buildGroupOverrides(s);
    }
  } catch { /* bad standings data — simulate all groups */ }
  try {
    const fixtures = events ? firstRoundFixtures(events) : [];
    set("worstReached", p => {
      const i = T.rounds.findIndex(r => r.slug === p.round);
      if (i === 0) {
        // Exact (incl. best thirds) once every first-round fixture is published; until then,
        // provisionally the worst team certain of a top-two finish
        const teams = fixtures.flat().filter(Boolean);
        return teams.length === 2 * T.bracket.length ? holder(worstByOdds(teams), true) : holder(qualified, groupsComplete);
      }
      if (!events) return null;
      // Reaching a later round = won the round before it
      const winners = roundWinners(events, T.rounds[i - 1].slug);
      return holder(worstByOdds(winners), winners.length === T.bracket.length >> (i - 1));
    });
    if (events) {
      live.knockoutResults = buildKnockoutResults(events);
      live.thirdPlaceOverrides = computeThirdPlaceOverrides(fixtures, live.groupOverrides);
    }
  } catch { /* bad scoreboard data — simulate all knockouts */ }
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

  const currently = live?.holders ?? {};
  const lockedCount = live ? Object.keys(live.groupOverrides).length : 0;
  const knockoutLockedCount = live ? Object.keys(live.knockoutResults).length : 0;

  async function runSim() {
    setRunning(true);
    setExpanded(null);
    const fresh = await loadLiveData();
    setLive(fresh);
    setTimeout(() => {
      try {
        setResults(runSimulations(10000, fresh.groupOverrides, currentOdds, fresh.knockoutResults, fresh.thirdPlaceOverrides));
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
        {T.prizes.map((p, i) => {
          const curr = currently[p.key];
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
                <span className={styles.evLocked}>Live standings used for {lockedCount}/{GROUP_COUNT} groups</span>
              </div>
            )}
            {knockoutLockedCount > 0 && (
              <div className={styles.evMeta}>
                <span className={styles.evLocked}>{knockoutLockedCount} knockout result{knockoutLockedCount !== 1 ? 's' : ''} locked in</span>
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
                        {T.prizes.map(({ key, short: label }) => {
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
