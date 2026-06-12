import { useState } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { runSimulations } from "../utils/monteCarlo";
import { getCached, setCache } from "../utils/cache";
import styles from "./PrizesPage.module.css";

const PRIZES = [
  { name: "Winner",                              amount: 200, top: true },
  { name: "Runner-up",                           amount: 80,  top: true },
  { name: "Third Place",                         amount: 40,  top: true },
  { name: "Player of the Tournament",            amount: 40  },
  { name: "Goal of the Tournament",              amount: 40  },
  { name: "Worst team to exit group stage",      amount: 20  },
  { name: "Worst team to reach Last 16",         amount: 20  },
  { name: "Worst team to reach Quarter-Finals",  amount: 20  },
  { name: "Worst team overall",                  amount: 20  },
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

function buildGroupOverrides(standings) {
  const overrides = {};
  const groups = standings?.children ?? standings?.standings?.groups ?? [];
  for (const group of groups) {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter || letter.length > 1) continue;
    const entries = group.standings?.entries ?? [];
    const getStats = e => Object.fromEntries((e.stats ?? []).map(s => [s.name, s.value]));
    const complete = entries.every(e => (getStats(e).gamesPlayed ?? 0) >= 3);
    if (!complete) continue;
    const sorted = [...entries].sort((a, b) => {
      const sa = getStats(a), sb = getStats(b);
      return (sb.points??0)-(sa.points??0) || (sb.pointDifferential??0)-(sa.pointDifferential??0) || (sb.pointsFor??0)-(sa.pointsFor??0);
    });
    const mapped = sorted.map(e => {
      const teamName = resolveEspnTeam(e.team?.displayName ?? "");
      if (!teamName) return null;
      const st = getStats(e);
      return { teamName, pts: st.points ?? 0, gd: st.pointDifferential ?? 0 };
    }).filter(Boolean);
    if (mapped.length === 4) overrides[letter] = mapped;
  }
  return overrides;
}

const byPerson = {};
draw.forEach(e => {
  const k = e.person ?? "Unclaimed";
  if (!byPerson[k]) byPerson[k] = [];
  byPerson[k].push(e);
});

export default function PrizesPage() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [lockedCount, setLockedCount] = useState(null);
  const [expanded, setExpanded] = useState(null);

  async function runSim() {
    setRunning(true);
    setExpanded(null);

    let groupOverrides = {};
    try {
      let standings = getCached(CACHE_KEY);
      if (!standings) {
        const res = await fetch(ESPN_STANDINGS);
        if (res.ok) { standings = await res.json(); setCache(CACHE_KEY, standings); }
      }
      if (standings) {
        groupOverrides = buildGroupOverrides(standings);
        setLockedCount(Object.keys(groupOverrides).length);
      }
    } catch { /* fall back to odds-only */ }

    setTimeout(() => {
      const result = runSimulations(10000, groupOverrides);
      setResults(result);
      setRunning(false);
    }, 10);
  }

  const people = Object.keys(byPerson);
  const fairShare = results
    ? Object.values(results.personEV).reduce((s,v) => s+v, 0) / people.length
    : TOTAL / people.length;

  const ranked = results
    ? Object.entries(results.personEV)
        .sort(([,a],[,b]) => b-a)
        .map(([name, ev], i) => ({ rank: i+1, name, ev }))
    : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Prize Money</h1>
      <div className={styles.list}>
        {PRIZES.map((p, i) => (
          <div key={p.name} className={`${styles.row} ${p.top ? styles.top : ""}`}>
            {p.top && <div className={styles.medal}>{i===0?"🥇":i===1?"🥈":"🥉"}</div>}
            {!p.top && <div className={styles.icon}>🏆</div>}
            <span className={styles.name}>{p.name}</span>
            <span className={styles.amount}>£{p.amount}</span>
          </div>
        ))}
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
            <div className={styles.evMeta}>
              Fair share: £{fairShare.toFixed(2)}
              {lockedCount !== null && (
                <span className={styles.evLocked}> · {lockedCount}/12 groups locked from live data</span>
              )}
            </div>
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
                      onKeyDown={e => e.key === 'Enter' && setExpanded(isOpen ? null : name)}
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
                          return (
                            <div key={key} className={styles.evBreakdownRow}>
                              <span className={styles.evBreakdownLabel}>{label}</span>
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
