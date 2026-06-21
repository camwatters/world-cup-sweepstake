import { useState, useEffect } from "react";
import { draw as rawDraw } from "../data/draw";
import Flag from "../components/Flag";
import { fetchCurrentOdds, getCachedOddsAge } from "../utils/oddsApi";
import styles from "./DrawPage.module.css";

const draw = rawDraw;

const TIERS = [
  { label: "Favourites",  max: 10 },
  { label: "Contenders",  max: 30 },
  { label: "Dark Horses", max: 100 },
  { label: "Outsiders",   max: 500 },
  { label: "Longshots",   max: Infinity },
];

function getTier(odds) {
  return TIERS.find((t) => odds <= t.max)?.label ?? "Longshots";
}

function fmtFractional(o) {
  const n = o - 1;
  if (Number.isInteger(n)) return `${n}/1`;
  return `${n * 2}/2`;
}

function fmtDecimal(o) {
  return o % 1 === 0 ? `${o}` : o.toFixed(2);
}

function fmtAge(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : `${m}m ago`;
}

const people = [...new Set(draw.map((d) => d.person).filter(Boolean))];

export default function DrawPage() {
  const [view, setView] = useState("teams");
  const [oddsMode, setOddsMode] = useState("pre");
  const [currentOdds, setCurrentOdds] = useState(null);
  const [oddsLoading, setOddsLoading] = useState(true);
  const [oddsAge, setOddsAge] = useState(null);

  useEffect(() => {
    async function load() {
      const odds = await fetchCurrentOdds();
      setCurrentOdds(odds);
      setOddsAge(getCachedOddsAge());
      setOddsLoading(false);
    }
    load();
  }, []);

  const effectiveDraw = draw.map(entry => ({
    ...entry,
    effectiveOdds: (oddsMode === 'current' && currentOdds?.[entry.team])
      ? currentOdds[entry.team]
      : entry.odds,
  }));
  const effectiveSorted = [...effectiveDraw].sort((a, b) => a.effectiveOdds - b.effectiveOdds);

  const fmtOdds = oddsMode === 'current' ? fmtDecimal : fmtFractional;
  const canShowCurrent = !oddsLoading && currentOdds !== null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>World Cup <span>Sweepstake</span></h1>
        <div className={styles.controls}>
          <div className={styles.toggle}>
            <button
              className={view === "teams" ? styles.active : ""}
              onClick={() => setView("teams")}
            >
              By Odds
            </button>
            <button
              className={view === "people" ? styles.active : ""}
              onClick={() => setView("people")}
            >
              By Person
            </button>
          </div>
          <div className={styles.toggle}>
            <button
              className={oddsMode === "pre" ? styles.active : ""}
              onClick={() => setOddsMode("pre")}
            >
              Pre-tournament
            </button>
            <button
              className={oddsMode === "current" ? styles.active : ""}
              onClick={() => canShowCurrent && setOddsMode("current")}
              disabled={!canShowCurrent}
              title={!oddsLoading && !currentOdds ? "Set VITE_ODDS_API_KEY to enable live odds" : undefined}
            >
              {oddsLoading ? "Loading…" : "Current"}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><strong>{draw.length}</strong> teams</div>
        <div className={styles.stat}><strong>{people.length}</strong> players</div>
        <div className={styles.stat}>
          Favourite: <strong>{effectiveSorted[0].team}</strong> ({fmtOdds(effectiveSorted[0].effectiveOdds)})
        </div>
        {oddsMode === 'current' && oddsAge !== null && (
          <div className={styles.stat}>Updated <strong>{fmtAge(oddsAge)}</strong></div>
        )}
      </div>

      {view === "teams"
        ? <TeamsView sorted={effectiveSorted} fmtOdds={fmtOdds} oddsMode={oddsMode} />
        : <PeopleView draw={effectiveDraw} fmtOdds={fmtOdds} oddsMode={oddsMode} />
      }
    </div>
  );
}

function TeamsView({ sorted, fmtOdds, oddsMode }) {
  let lastTier = null;
  const items = [];

  sorted.forEach((entry, i) => {
    const tier = getTier(entry.effectiveOdds);
    if (tier !== lastTier) {
      items.push(<div key={`tier-${tier}`} className={styles.tierLabel}>{tier}</div>);
      lastTier = tier;
    }
    items.push(
      <TeamCard key={entry.team} entry={entry} rank={i + 1} fmtOdds={fmtOdds} oddsMode={oddsMode} />
    );
  });

  return <div className={styles.grid}>{items}</div>;
}

function TeamCard({ entry, rank, fmtOdds, oddsMode }) {
  const isFav = entry.effectiveOdds <= 10;
  const showWas = oddsMode === 'current' && entry.effectiveOdds !== entry.odds;
  return (
    <div className={`${styles.card} ${isFav ? styles.cardFav : ""}`}>
      <div className={styles.rank}>{rank}</div>
      <Flag code={entry.flag} size={32} />
      <div className={styles.info}>
        <div className={styles.teamName}>{entry.team}</div>
        {entry.person && <div className={styles.person}>{entry.person}</div>}
      </div>
      <div className={styles.oddsCol}>
        <div className={styles.oddsVal}>{fmtOdds(entry.effectiveOdds)}</div>
        {showWas
          ? <div className={styles.oddsWas}>was {fmtFractional(entry.odds)}</div>
          : <div className={styles.oddsLabel}>to win</div>
        }
      </div>
    </div>
  );
}

function PeopleView({ draw, fmtOdds }) {
  const byPerson = {};
  draw.forEach((entry) => {
    const key = entry.person ?? "Unclaimed";
    if (!byPerson[key]) byPerson[key] = [];
    byPerson[key].push(entry);
  });

  const sortedPeople = Object.entries(byPerson).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className={styles.peopleGrid}>
      {sortedPeople.map(([person, teams]) => {
        const bestOdds = Math.min(...teams.map((t) => t.effectiveOdds));
        return (
          <div key={person} className={styles.personCard}>
            <div className={styles.personHeader}>
              <span className={styles.personName}>{person}</span>
              <span className={styles.personBest}>best: {fmtOdds(bestOdds)}</span>
            </div>
            {teams
              .sort((a, b) => a.effectiveOdds - b.effectiveOdds)
              .map((t) => (
                <div key={t.team} className={styles.personTeamRow}>
                  <Flag code={t.flag} size={22} />
                  <span>{t.team}</span>
                  <span className={styles.smallOdds}>{fmtOdds(t.effectiveOdds)}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
