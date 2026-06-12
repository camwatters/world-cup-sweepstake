import { useState } from "react";
import styles from "./AdminPage.module.css";

const STORAGE_KEY = "manual_odds_override";

function parseOddsText(text) {
  const result = {};
  text.split("\n").forEach((line) => {
    const parts = line.trim().split(/\t|  +/); // tab or 2+ spaces
    if (parts.length >= 2) {
      const team = parts[0].trim();
      const odds = parseFloat(parts[1]);
      if (team && !isNaN(odds)) result[team] = odds;
    }
  });
  return result;
}

export default function AdminPage() {
  const stored = localStorage.getItem(STORAGE_KEY) ?? "";
  const [text, setText] = useState(() => {
    try {
      const obj = JSON.parse(stored);
      return Object.entries(obj)
        .map(([t, o]) => `${t}\t${o}`)
        .join("\n");
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const parsed = parseOddsText(text);
    const count = Object.keys(parsed).length;
    if (count === 0) {
      alert("No valid odds found. Format: TeamName<tab>Odds, one per line.");
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    localStorage.removeItem(STORAGE_KEY);
    setText("");
  }

  return (
    <div className={styles.page}>
      <h1>Manual Odds Override</h1>
      <p className={styles.help}>
        Paste updated odds below — one team per line, team name then a tab or two spaces then the odds number.
        These override the hardcoded odds on the Draw page and are saved in your browser.
      </p>
      <pre className={styles.example}>
{`Spain\t4.5
France\t5.5
England\t7
...`}
      </pre>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Spain\t4.5\nFrance\t5.5\n..."}
        spellCheck={false}
      />
      <div className={styles.actions}>
        <button className={styles.save} onClick={handleSave}>
          {saved ? "Saved ✓" : "Save odds"}
        </button>
        <button className={styles.clear} onClick={handleClear}>Clear override</button>
      </div>
    </div>
  );
}
