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

const COLORS = [
  "#e8c84a", "#c0c0c0", "#cd7f32",
  "#6ee7b7", "#93c5fd", "#f9a8d4",
  "#fcd34d", "#a78bfa", "#fb923c",
];

// Assign a consistent color per person
const people = [...new Set(draw.map((d) => d.person).filter(Boolean))].sort();
const personColor = Object.fromEntries(people.map((p, i) => [p, COLORS[i % COLORS.length]]));

export default function DrawPage() {
  const [view, setView] = useState("teams"); // "teams" | "people"

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>The Draw</h1>
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

      {view === "teams" ? <TeamsView /> : <PeopleView />}
    </div>
  );
}

function TeamsView() {
  return (
    <div className={styles.grid}>
      {sorted.map((entry, i) => (
        <TeamCard key={entry.team} entry={entry} rank={i + 1} />
      ))}
    </div>
  );
}

function TeamCard({ entry, rank }) {
  const color = entry.person ? personColor[entry.person] : "#64748b";
  return (
    <div className={styles.card} style={{ "--accent": color }}>
      <div className={styles.rank}>#{rank}</div>
      <Flag code={entry.flag} size={40} />
      <div className={styles.info}>
        <div className={styles.teamName}>{entry.team}</div>
        <div className={styles.odds}>{entry.odds}/1</div>
      </div>
      <div className={styles.person} style={{ background: color }}>
        {entry.person ?? "—"}
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
        const color = person !== "Unclaimed" ? personColor[person] : "#64748b";
        const bestOdds = Math.min(...teams.map((t) => t.odds));
        return (
          <div key={person} className={styles.personCard} style={{ "--accent": color }}>
            <div className={styles.personHeader} style={{ borderColor: color }}>
              <span className={styles.personName}>{person}</span>
              <span className={styles.personBest}>best: {bestOdds}/1</span>
            </div>
            {teams
              .sort((a, b) => a.odds - b.odds)
              .map((t) => (
                <div key={t.team} className={styles.personTeamRow}>
                  <Flag code={t.flag} size={24} />
                  <span>{t.team}</span>
                  <span className={styles.smallOdds}>{t.odds}/1</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
