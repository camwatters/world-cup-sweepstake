import { useState, useEffect } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { runSimulations } from "../utils/monteCarlo";
import { getCached, setCache, TTL } from "../utils/cache";
import styles from "./PrizesPage.module.css";

const PRIZES = [
  { name: "Winner",                              amount: 200, top: true },
  { name: "Runner-up",                           amount: 80,  top: true },
  { name: "Third Place",                         amount: 40,  top: true },
  { name: "Player of the Tournament",            amount: 40  },
  { name: "Goal of the Tournament",              amount: 40,  currentKey: "gott" },
  { name: "Worst Team Overall",                  amount: 20,  currentKey: "worstOverall" },
  { name: "Worst Team to exit Group Stage",      amount: 20  },
  { name: "Worst Team to reach Last 16",         amount: 20  },
  { name: "Worst Team to reach Quarter-Finals",  amount: 20  },
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

const ESPN_ALIASES = {
  "czechia": "czech republic",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "türkiye": "turkey",
  "united states": "usa",
  "curaçao": "curacao",
  "congo dr": "dr congo",
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
    if (minPlayed === 0 && maxPlayed === 0) continue;
    if (minPlayed !== maxPlayed) continue; // mid-matchday — skip
    const complete = minPlayed >= 3;
    const sorted = [...entries].sort((a, b) => {
      const sa = getStats(a), sb = getStats(b);
      return (sb.points??0)-(sa.points??0) || (sb.pointDifferential??0)-(sa.pointDifferential??0) || (sb.pointsFor??0)-(sa.pointsFor??0);
    });
    const teams = sorted.map(e => {
      const teamName = resolveEspnTeam(e.team?.displayName ?? "");
      if (!teamName) return null;
      const st = getStats(e);
      return { teamName, pts: st.points ?? 0, gd: st.pointDifferential ?? 0, gf: st.pointsFor ?? 0 };
    }).filter(Boolean);
    if (teams.length === 4) overrides[letter] = { teams, complete, matchdaysPlayed: minPlayed };
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
  gott: { entry: draw.find(t => t.team === "South Korea"), quality: 0.3, perGameProb: 0.2 },
};

export default function PrizesPage() {
  const [results, setResults]       = useState(null);
  const [running, setRunning]       = useState(false);
  const [lockedCount, setLockedCount] = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [worstTeam, setWorstTeam]   = useState(null);
  const [standingsRef, setStandingsRef] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        let s = getCached(CACHE_KEY, TTL.STANDINGS);
        if (!s) {
          const res = await fetch(ESPN_STANDINGS);
          if (res.ok) { s = await res.json(); setCache(CACHE_KEY, s); }
        }
        if (s) { setStandingsRef(s); setWorstTeam(computeWorstTeam(s)); }
      } catch {}
    }
    load();
  }, []);

  const currently = {
    gott: MANUAL_CURRENT.gott?.entry,
    worstOverall: worstTeam,
  };

  async function runSim() {
    setRunning(true);
    setExpanded(null);
    let groupOverrides = {};
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
    setTimeout(() => {
      const gottEntry = MANUAL_CURRENT.gott;
      const gottConfig = gottEntry ? { teamName: gottEntry.entry.team, quality: gottEntry.quality, perGameProb: gottEntry.perGameProb } : null;
      const result = runSimulations(10000, groupOverrides, gottConfig);
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
                  <span className={styles.currently}>
                    Currently:&nbsp;
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
              Simulates 10,000 tournaments using bookmaker odds. Pulls live standings — completed groups are locked in, the rest are simulated.
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
                              <span className={styles.evBreakdownLabel}>{label}</span>
                              <div className={styles.evBreakdownRight}>
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
                                <span className={styles.evBreakdownVal}>£{val.toFixed(2)}</span>
                              </div>
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
