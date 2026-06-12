import { useState } from "react";
import { draw as rawDraw } from "../data/draw";
import Flag from "../components/Flag";
import styles from "./DrawPage.module.css";

function applyOddsOverride(entries) {
  try {
    const override = JSON.parse(localStorage.getItem("manual_odds_override") ?? "{}");
    if (!Object.keys(override).length) return entries;
    return entries.map((e) => {
      const key = Object.keys(override).find(
        (k) => k.toLowerCase() === e.team.toLowerCase()
      );
      return key ? { ...e, odds: override[key] } : e;
    });
  } catch {
    return entries;
  }
}

const draw = applyOddsOverride(rawDraw);
const sorted = [...draw].sort((a, b) => a.odds - b.odds);

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

function fmtOdds(o) {
  if (o >= 1000) return (o / 1000).toFixed(1).replace(".0", "") + "k";
  return String(o);
}

const people = [...new Set(draw.map((d) => d.person).filter(Boolean))];

export default function DrawPage() {
  const [view, setView] = useState("teams");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>World Cup <span>Sweepstake</span></h1>
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
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><strong>{draw.length}</strong> teams</div>
        <div className={styles.stat}><strong>{people.length}</strong> players</div>
        <div className={styles.stat}>Favourite: <strong>{sorted[0].team}</strong></div>
      </div>

      {view === "teams" ? <TeamsView /> : <PeopleView />}
    </div>
  );
}

function TeamsView() {
  let lastTier = null;
  const items = [];

  sorted.forEach((entry, i) => {
    const tier = getTier(entry.odds);
    if (tier !== lastTier) {
      items.push(<div key={`tier-${tier}`} className={styles.tierLabel}>{tier}</div>);
      lastTier = tier;
    }
    items.push(<TeamCard key={entry.team} entry={entry} rank={i + 1} />);
  });

  return <div className={styles.grid}>{items}</div>;
}

function TeamCard({ entry, rank }) {
  const isFav = entry.odds <= 10;
  return (
    <div className={`${styles.card} ${isFav ? styles.cardFav : ""}`}>
      <div className={styles.rank}>{rank}</div>
      <Flag code={entry.flag} size={32} />
      <div className={styles.info}>
        <div className={styles.teamName}>{entry.team}</div>
        {entry.person && <div className={styles.person}>{entry.person}</div>}
      </div>
      <div className={styles.oddsCol}>
        <div className={styles.oddsVal}>{fmtOdds(entry.odds)}/1</div>
        <div className={styles.oddsLabel}>to win</div>
      </div>
    </div>
  );
}

function PeopleView() {
  const byPerson = {};
  draw.forEach((entry) => {
    const key = entry.person ?? "Unclaimed";
    if (!byPerson[key]) byPerson[key] = [];
    byPerson[key].push(entry);
  });

  const sortedPeople = Object.entries(byPerson).sort(([, a], [, b]) => {
    const bestA = Math.min(...a.map((e) => e.odds));
    const bestB = Math.min(...b.map((e) => e.odds));
    return bestA - bestB;
  });

  return (
    <div className={styles.peopleGrid}>
      {sortedPeople.map(([person, teams]) => {
        const bestOdds = Math.min(...teams.map((t) => t.odds));
        return (
          <div key={person} className={styles.personCard}>
            <div className={styles.personHeader}>
              <span className={styles.personName}>{person}</span>
              <span className={styles.personBest}>best: {fmtOdds(bestOdds)}/1</span>
            </div>
            {teams
              .sort((a, b) => a.odds - b.odds)
              .map((t) => (
                <div key={t.team} className={styles.personTeamRow}>
                  <Flag code={t.flag} size={22} />
                  <span>{t.team}</span>
                  <span className={styles.smallOdds}>{fmtOdds(t.odds)}/1</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
