import { useState } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { runSimulations } from "../utils/monteCarlo";
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

const TOTAL = PRIZES.reduce((s, p) => s + p.amount, 0);

const byPerson = {};
draw.forEach((e) => {
  const k = e.person ?? "Unclaimed";
  if (!byPerson[k]) byPerson[k] = [];
  byPerson[k].push(e);
});

export default function PrizesPage() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  function runSim() {
    setRunning(true);
    setTimeout(() => {
      const ev = runSimulations(10000);
      setResults(ev);
      setRunning(false);
    }, 0);
  }

  const people = Object.keys(byPerson);
  const fairShare = results
    ? Object.values(results).reduce((s, v) => s + v, 0) / people.length
    : TOTAL / people.length;

  const ranked = results
    ? Object.entries(results)
        .sort(([, a], [, b]) => b - a)
        .map(([name, ev], i) => ({ rank: i + 1, name, ev }))
    : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Prize Money</h1>
      <div className={styles.list}>
        {PRIZES.map((p, i) => (
          <div key={p.name} className={`${styles.row} ${p.top ? styles.top : ""}`}>
            {p.top && <div className={styles.medal}>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</div>}
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
              Simulates 10,000 tournaments using bookmaker odds to estimate what each ticket is worth.
            </p>
          </div>
          <button
            className={styles.simBtn}
            onClick={runSim}
            disabled={running}
          >
            {running ? "Running…" : results ? "Re-run" : "Run simulation"}
          </button>
        </div>

        {ranked && (
          <div className={styles.evTable}>
            <div className={styles.evNote}>
              Fair share: £{fairShare.toFixed(2)} &middot; Total pot: £{TOTAL}
            </div>
            {ranked.map(({ rank, name, ev }) => {
              const teams = (byPerson[name] ?? []).sort((a, b) => a.odds - b.odds);
              const above = ev >= fairShare;
              return (
                <div key={name} className={`${styles.evRow} ${above ? styles.evAbove : ""}`}>
                  <span className={styles.evRank}>{rank}</span>
                  <div className={styles.evPerson}>
                    <span className={styles.evName}>{name}</span>
                    <div className={styles.evTeams}>
                      {teams.map((t) => (
                        <span key={t.team} className={styles.evTeam}>
                          <Flag code={t.flag} size={14} />
                          {t.team}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`${styles.evAmount} ${above ? styles.evAmountGold : ""}`}>
                    £{ev.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
