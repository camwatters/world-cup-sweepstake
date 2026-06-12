import { useEffect, useState } from "react";
import { draw } from "../data/draw";
import Flag from "../components/Flag";
import { getCached, setCache } from "../utils/cache";
import styles from "./GroupsPage.module.css";

const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const CACHE_KEY_STANDINGS = "espn_standings";
const CACHE_KEY_SCOREBOARD = "espn_scoreboard";

const ESPN_ALIASES = {
  "czechia": "czech republic",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "türkiye": "turkey",
  "united states": "usa",
  "curaçao": "curacao",
  "congo dr": "dr congo",
};

const teamLookup = {};
draw.forEach((e) => {
  teamLookup[e.team.toLowerCase()] = e;
});

function findEntry(espnName) {
  if (!espnName) return null;
  const lower = espnName.toLowerCase();
  const resolved = ESPN_ALIASES[lower] ?? lower;
  if (teamLookup[resolved]) return teamLookup[resolved];
  for (const [key, val] of Object.entries(teamLookup)) {
    if (resolved.includes(key) || key.includes(resolved)) return val;
  }
  return null;
}

async function fetchWithCache(url, cacheKey) {
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

export default function GroupsPage() {
  const [standings, setStandings] = useState(null);
  const [scoreboard, setScoreboard] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("groups");

  useEffect(() => {
    Promise.all([
      fetchWithCache(ESPN_STANDINGS, CACHE_KEY_STANDINGS),
      fetchWithCache(ESPN_SCOREBOARD, CACHE_KEY_SCOREBOARD),
    ])
      .then(([s, sc]) => {
        setStandings(s);
        setScoreboard(sc);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load ESPN data: {error}</p>
      </div>
    );
  }

  if (!standings && !scoreboard) {
    return <div className={styles.page}><p className={styles.loading}>Loading…</p></div>;
  }

  const groups = standings?.children ?? [];
  const events = scoreboard?.events ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <button className={tab === "groups" ? styles.active : ""} onClick={() => setTab("groups")}>Groups</button>
        <button className={tab === "fixtures" ? styles.active : ""} onClick={() => setTab("fixtures")}>Fixtures</button>
      </div>

      {tab === "groups" && (
        <div className={styles.groupsGrid}>
          {groups.length === 0 && <p className={styles.empty}>No group data available yet.</p>}
          {groups.map((group) => (
            <GroupTable key={group.uid ?? group.name} group={group} />
          ))}
        </div>
      )}

      {tab === "fixtures" && (
        <div className={styles.fixtures}>
          {events.length === 0 && <p className={styles.empty}>No fixtures available yet.</p>}
          {events.map((event) => (
            <FixtureRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTable({ group }) {
  const entries = group.standings?.entries ?? [];
  return (
    <div className={styles.groupCard}>
      <h3 className={styles.groupTitle}>{group.name ?? group.abbreviation}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.teamCol}>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const teamName = entry.team?.displayName ?? entry.team?.name ?? "";
            const sweepEntry = findEntry(teamName);
            const stats = Object.fromEntries(
              (entry.stats ?? []).map((s) => [s.name, s.value])
            );
            return (
              <tr key={entry.team?.id ?? teamName}>
                <td className={styles.teamCell}>
                  {sweepEntry ? (
                    <Flag code={sweepEntry.flag} size={20} />
                  ) : (
                    <img
                      src={entry.team?.logos?.[0]?.href}
                      width={30}
                      height={20}
                      alt=""
                      style={{ objectFit: "contain" }}
                    />
                  )}
                  <span className={styles.espnTeamName}>{teamName}</span>
                  {sweepEntry?.person && (
                    <span className={styles.ownerBadge}>{sweepEntry.person}</span>
                  )}
                </td>
                <td>{stats.gamesPlayed ?? 0}</td>
                <td>{stats.wins ?? 0}</td>
                <td>{stats.ties ?? 0}</td>
                <td>{stats.losses ?? 0}</td>
                <td>{stats.pointDifferential ?? 0}</td>
                <td><strong>{stats.points ?? 0}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FixtureRow({ event }) {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((c) => c.homeAway === "home");
  const away = competition?.competitors?.find((c) => c.homeAway === "away");
  const status = competition?.status;
  const isLive = status?.type?.state === "in";
  const isFinished = status?.type?.completed;

  const homeEntry = findEntry(home?.team?.displayName);
  const awayEntry = findEntry(away?.team?.displayName);

  return (
    <div className={`${styles.fixtureRow} ${isLive ? styles.live : ""}`}>
      <div className={styles.fixtureDate}>
        {isLive ? (
          <span className={styles.liveDot}>LIVE {status?.displayClock}</span>
        ) : (
          formatDate(event.date)
        )}
      </div>
      <div className={styles.fixtureTeams}>
        <TeamSlot entry={homeEntry} team={home?.team} score={home?.score} />
        <div className={styles.vs}>
          {isFinished || isLive ? (
            <span className={styles.score}>{home?.score} – {away?.score}</span>
          ) : (
            <span className={styles.vsText}>vs</span>
          )}
        </div>
        <TeamSlot entry={awayEntry} team={away?.team} score={away?.score} right />
      </div>
      {event.name && (
        <div className={styles.fixtureGroup}>{competition?.groups?.name ?? event.name}</div>
      )}
    </div>
  );
}

function TeamSlot({ entry, team, right }) {
  const name = team?.displayName ?? team?.shortDisplayName ?? "";
  return (
    <div className={`${styles.teamSlot} ${right ? styles.right : ""}`}>
      {!right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
      <div className={styles.slotInfo}>
        <span className={styles.slotName}>{name}</span>
        {entry?.person && <span className={styles.slotOwner}>{entry.person}</span>}
      </div>
      {right && (entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />)}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
