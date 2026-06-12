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

function getStats(entry) {
  return Object.fromEntries((entry.stats ?? []).map((s) => [s.name, s.value]));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const sa = getStats(a), sb = getStats(b);
    return (sb.points ?? 0) - (sa.points ?? 0)
      || (sb.pointDifferential ?? 0) - (sa.pointDifferential ?? 0)
      || (sb.pointsFor ?? sb.goalsScored ?? 0) - (sa.pointsFor ?? sa.goalsScored ?? 0);
  });
}

function computeQualifiers(groups) {
  const winners = {}, runnersUp = {}, allThirds = [];
  groups.forEach((group) => {
    const letter = (group.name ?? "").replace("Group ", "").trim();
    if (!letter) return;
    const sorted = sortEntries(group.standings?.entries ?? []);
    if (sorted[0]) winners[letter] = sorted[0].team?.displayName ?? "";
    if (sorted[1]) runnersUp[letter] = sorted[1].team?.displayName ?? "";
    if (sorted[2]) {
      const st = getStats(sorted[2]);
      allThirds.push({
        group: letter,
        name: sorted[2].team?.displayName ?? "",
        played: st.gamesPlayed ?? 0,
        points: st.points ?? 0,
        gd: st.pointDifferential ?? 0,
        gf: st.pointsFor ?? 0,
        ga: st.pointsAgainst ?? 0,
      });
    }
  });
  // Sort by pts → GD → GF (FIFA tiebreak criteria for 3rd-place ranking)
  allThirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  const best8 = new Set(allThirds.slice(0, 8).map((t) => t.name));
  return { winners, runnersUp, allThirds, best8thirds: [...best8] };
}

// Static bracket from FIFA schedule (teams TBD after group stage, June 26+)
const R32_SCHEDULE = [
  { date: "28 Jun", venue: "Inglewood",    home: "Runner-up Group A", away: "Runner-up Group B" },
  { date: "29 Jun", venue: "Foxborough",   home: "Winner Group E",    away: "Best 3rd A/B/C/D/F" },
  { date: "29 Jun", venue: "Guadalupe",    home: "Winner Group F",    away: "Runner-up Group C" },
  { date: "29 Jun", venue: "Houston",      home: "Winner Group C",    away: "Runner-up Group F" },
  { date: "30 Jun", venue: "East Rutherford", home: "Winner Group I", away: "Best 3rd C/D/F/G/H" },
  { date: "30 Jun", venue: "Arlington",    home: "Runner-up Group E", away: "Runner-up Group I" },
  { date: "30 Jun", venue: "Mexico City",  home: "Winner Group A",    away: "Best 3rd C/E/F/H/I" },
  { date: "1 Jul",  venue: "Atlanta",      home: "Winner Group L",    away: "Best 3rd E/H/I/J/K" },
  { date: "1 Jul",  venue: "Santa Clara",  home: "Winner Group D",    away: "Best 3rd B/E/F/I/J" },
  { date: "1 Jul",  venue: "Seattle",      home: "Winner Group G",    away: "Best 3rd A/E/H/I/J" },
  { date: "2 Jul",  venue: "Toronto",      home: "Runner-up Group K", away: "Runner-up Group L" },
  { date: "2 Jul",  venue: "Inglewood",    home: "Winner Group H",    away: "Runner-up Group J" },
  { date: "2 Jul",  venue: "Vancouver",    home: "Winner Group B",    away: "Best 3rd E/F/G/I/J" },
  { date: "3 Jul",  venue: "Miami Gardens",home: "Winner Group J",    away: "Runner-up Group H" },
  { date: "3 Jul",  venue: "Arlington",    home: "Runner-up Group D", away: "Runner-up Group G" },
  { date: "3 Jul",  venue: "Kansas City",  home: "Winner Group K",    away: "Best 3rd D/E/I/J/L" },
];

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

  const groups = standings?.children ?? [];
  const events = scoreboard?.events ?? [];

  const knockoutEvents = events.filter((e) => {
    const groupName = e.competitions?.[0]?.groups?.name ?? "";
    return groupName !== "group-stage" && groupName !== "";
  });

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <button className={tab === "groups" ? styles.active : ""} onClick={() => setTab("groups")}>Groups</button>
        <button className={tab === "fixtures" ? styles.active : ""} onClick={() => setTab("fixtures")}>Fixtures</button>
        <button className={tab === "bracket" ? styles.active : ""} onClick={() => setTab("bracket")}>Bracket</button>
      </div>

      {tab === "groups" && (
        <div className={styles.groupsGrid}>
          {!standings && <p className={styles.loading}>Loading…</p>}
          {groups.length === 0 && standings && <p className={styles.empty}>No group data available yet.</p>}
          {groups.map((group) => (
            <GroupTable key={group.uid ?? group.name} group={group} />
          ))}
        </div>
      )}

      {tab === "fixtures" && (
        <div className={styles.fixtures}>
          {!scoreboard && <p className={styles.loading}>Loading…</p>}
          {scoreboard && events.length === 0 && <p className={styles.empty}>No fixtures available yet.</p>}
          {events.map((event) => (
            <FixtureRow key={event.id} event={event} />
          ))}
        </div>
      )}

      {tab === "bracket" && (
        <BracketTab knockoutEvents={knockoutEvents} qualifiers={computeQualifiers(groups)} />
      )}
    </div>
  );
}

function GroupTable({ group }) {
  const entries = [...(group.standings?.entries ?? [])].sort((a, b) => {
    const sa = Object.fromEntries((a.stats ?? []).map((s) => [s.name, s.value]));
    const sb = Object.fromEntries((b.stats ?? []).map((s) => [s.name, s.value]));
    return (sb.points ?? 0) - (sa.points ?? 0) || (sb.pointDifferential ?? 0) - (sa.pointDifferential ?? 0);
  });
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

function resolveSlot(label, qualifiers) {
  const { winners, runnersUp, best8thirds } = qualifiers;
  const winM = label.match(/^Winner Group ([A-L])$/);
  if (winM) return { label, team: winners[winM[1]] || null };
  const runM = label.match(/^Runner-up Group ([A-L])$/);
  if (runM) return { label, team: runnersUp[runM[1]] || null };
  if (label.startsWith("Best 3rd")) {
    const count = best8thirds.length;
    return { label, team: count >= 8 ? "(TBD from 3rd)" : `(best 8 of 12 thirds, ${count} groups done)`, muted: true };
  }
  return { label, team: null };
}

function ThirdPlaceTable({ allThirds, best8thirds }) {
  if (allThirds.length === 0) return null;
  const best8 = new Set(best8thirds);
  return (
    <div className={styles.thirdsTable}>
      <h3 className={styles.bracketRoundTitle}>Best 3rd-Place Rankings</h3>
      <p className={styles.thirdsNote}>Top 8 qualify for Round of 32 · Ranked by Pts → GD → GF</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.teamCol}>Team</th>
            <th>Grp</th>
            <th>P</th>
            <th>GD</th>
            <th>GF</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {allThirds.map((t, i) => {
            const entry = findEntry(t.name);
            const qualifying = best8.has(t.name);
            return (
              <tr key={t.name} className={qualifying ? styles.qualifyingRow : styles.eliminatedRow}>
                <td className={styles.teamCell}>
                  <span className={styles.thirdsRank}>{i + 1}</span>
                  {entry && <Flag code={entry.flag} size={18} />}
                  <span className={styles.espnTeamName}>{t.name}</span>
                  {qualifying && i < 8 && <span className={styles.qualifyBadge}>Q</span>}
                </td>
                <td>{t.group}</td>
                <td>{t.played}</td>
                <td>{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
                <td>{t.gf}</td>
                <td><strong>{t.points}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BracketTab({ knockoutEvents, qualifiers }) {
  if (knockoutEvents.length > 0) {
    const byRound = {};
    knockoutEvents.forEach((e) => {
      const round = e.competitions?.[0]?.groups?.name ?? "Unknown";
      if (!byRound[round]) byRound[round] = [];
      byRound[round].push(e);
    });
    return (
      <div className={styles.bracket}>
        {Object.entries(byRound).map(([round, events]) => (
          <div key={round} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{round}</h3>
            <div className={styles.bracketMatches}>
              {events.map((event) => (
                <FixtureRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.bracket}>
      <div className={styles.bracketBanner}>
        <span>Group stage ends ~26 Jun · Knockout stage begins 28 Jun · Teams TBD</span>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Round of 32</h3>
        <div className={styles.bracketMatches}>
          {R32_SCHEDULE.map((m) => {
            const home = resolveSlot(m.home, qualifiers);
            const away = resolveSlot(m.away, qualifiers);
            const homeEntry = home.team ? findEntry(home.team) : null;
            const awayEntry = away.team ? findEntry(away.team) : null;
            return (
              <div key={`${m.date}-${m.home}`} className={styles.staticMatch}>
                <div className={styles.staticMeta}>{m.date} · {m.venue}</div>
                <div className={styles.staticTeams}>
                  <div className={styles.staticSlot}>
                    {homeEntry && <Flag code={homeEntry.flag} size={18} />}
                    <div>
                      <div className={styles.staticTeam}>{home.team || home.label}</div>
                      {home.team && <div className={styles.staticSub}>{home.label}</div>}
                    </div>
                  </div>
                  <span className={styles.staticVs}>vs</span>
                  <div className={`${styles.staticSlot} ${styles.staticSlotRight}`}>
                    <div style={{ textAlign: "right" }}>
                      <div className={styles.staticTeam}>{away.team || away.label}</div>
                      {away.team && <div className={styles.staticSub}>{away.label}</div>}
                    </div>
                    {awayEntry && <Flag code={awayEntry.flag} size={18} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ThirdPlaceTable allThirds={qualifiers.allThirds} best8thirds={qualifiers.best8thirds} />

      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Round of 16 · 4–7 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Round of 32</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Quarter-finals · 9–11 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Round of 16</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Semi-finals · 14–15 Jul</h3>
        <p className={styles.bracketTbd}>Teams determined after Quarter-finals</p>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>Final · 19 Jul · MetLife Stadium</h3>
        <p className={styles.bracketTbd}>Teams determined after Semi-finals</p>
      </div>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
