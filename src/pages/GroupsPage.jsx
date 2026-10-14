import { useEffect, useState } from "react";
import Flag from "../components/Flag";
import CircularBracket from "../components/CircularBracket";
import T from "../tournament";
import { findEntry, getStats, standingsGroups, groupLetter, sortEntries, homeAway, roundOf, isKnockout, isFirstRound, teamKey, pairKey, fetchTournamentEvents, fetchStandings } from "../utils/espn";
import { GROUP_COUNT, parseSlot, slotLabel, pairUp, assignThirds } from "../utils/bracket";
import styles from "./GroupsPage.module.css";

// Build per-group fixture data from group-stage events: completed results (for H2H
// tiebreakers) and remaining fixtures. Teams are matched to groups via the standings.
function buildFixtureData(groupEvents, groups) {
  const teamToGroup = {};
  groups.forEach((group) => {
    const letter = groupLetter(group);
    if (!letter || letter.length > 1) return;
    (group.standings?.entries ?? []).forEach((e) => {
      const name = (e.team?.displayName ?? "").toLowerCase();
      if (name) teamToGroup[name] = letter;
    });
  });

  const groupFixtures = {};
  groupEvents.forEach((event) => {
    const [home, away] = homeAway(event);
    if (!home || !away) return;
    const homeName = home.team?.displayName ?? "";
    const awayName = away.team?.displayName ?? "";
    const letter = teamToGroup[homeName.toLowerCase()] ?? teamToGroup[awayName.toLowerCase()];
    if (!letter) return;
    groupFixtures[letter] ??= { completed: [], remaining: [] };
    if (event.competitions?.[0]?.status?.type?.completed) {
      groupFixtures[letter].completed.push({
        home: homeName,
        away: awayName,
        homeScore: parseInt(home.score ?? "0") || 0,
        awayScore: parseInt(away.score ?? "0") || 0,
      });
    } else {
      groupFixtures[letter].remaining.push({ home: homeName, away: awayName });
    }
  });

  return groupFixtures;
}

// Enumerate all possible outcomes of remaining games and return the set of
// positions each team can finish in. Uses FIFA WC tiebreaker order:
// pts → H2H pts → H2H GD → H2H GF → overall GD → overall GF
function computeFeasiblePositions(groupEntry, fixtureData) {
  const letter = groupLetter(groupEntry);
  const fixtures = fixtureData?.[letter];
  if (!fixtures) return null; // no data for this group

  const teams = (groupEntry.standings?.entries ?? []).map((e) => {
    const st = getStats(e);
    return {
      name: e.team?.displayName ?? "",
      pts: st.points ?? 0,
      gd: st.pointDifferential ?? 0,
      gf: st.pointsFor ?? 0,
      played: st.gamesPlayed ?? 0,
    };
  });
  if (teams.length === 0) return null;

  const remaining = fixtures.remaining;

  // If we found 0 remaining games but the group isn't actually finished
  // (some team hasn't played all 3 matchdays), our data fetch was incomplete.
  // Return null rather than falsely marking current leaders as guaranteed.
  if (remaining.length === 0 && teams.some((t) => t.played < 3)) return null;

  // Build H2H lookup from completed matches
  const h2h = {};
  fixtures.completed.forEach(({ home, away, homeScore, awayScore }) => {
    const key = [home, away].sort().join("|");
    const hPts = homeScore > awayScore ? 3 : homeScore === awayScore ? 1 : 0;
    const aPts = awayScore > homeScore ? 3 : homeScore === awayScore ? 1 : 0;
    h2h[key] = {
      [home]: { pts: hPts, gd: homeScore - awayScore, gf: homeScore },
      [away]: { pts: aPts, gd: awayScore - homeScore, gf: awayScore },
    };
  });

  function rankTeams(simTeams, simH2H) {
    return [...simTeams].sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      // H2H between this pair
      const key = [a.name, b.name].sort().join("|");
      const m = simH2H[key];
      if (m?.[a.name] && m?.[b.name]) {
        const aH = m[a.name], bH = m[b.name];
        if (bH.pts !== aH.pts) return bH.pts - aH.pts;
        if (bH.gd !== aH.gd) return bH.gd - aH.gd;
        if (bH.gf !== aH.gf) return bH.gf - aH.gf;
      }
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
  }

  const possiblePositions = {};
  teams.forEach((t) => (possiblePositions[t.name] = new Set()));

  const total = 3 ** remaining.length; // W/D/L per remaining game
  for (let i = 0; i < total; i++) {
    const simTeams = teams.map((t) => ({ ...t }));
    const simH2H = Object.fromEntries(Object.entries(h2h).map(([k, v]) => [k, { ...v }]));
    let code = i;

    for (let j = 0; j < remaining.length; j++) {
      const outcome = code % 3; // 0=homeWin 1=draw 2=awayWin
      code = Math.floor(code / 3);
      const game = remaining[j];
      const homeT = simTeams.find((t) => t.name === game.home);
      const awayT = simTeams.find((t) => t.name === game.away);
      if (!homeT || !awayT) continue;

      // Synthetic score: 1-0 win, 0-0 draw, 0-1 loss
      const hScore = outcome === 0 ? 1 : 0;
      const aScore = outcome === 2 ? 1 : 0;
      const hPts = outcome === 0 ? 3 : outcome === 1 ? 1 : 0;
      const aPts = outcome === 2 ? 3 : outcome === 1 ? 1 : 0;

      homeT.pts += hPts; homeT.gd += hScore - aScore; homeT.gf += hScore;
      awayT.pts += aPts; awayT.gd += aScore - hScore; awayT.gf += aScore;

      const key = [game.home, game.away].sort().join("|");
      simH2H[key] = {
        [game.home]: { pts: hPts, gd: hScore - aScore, gf: hScore },
        [game.away]: { pts: aPts, gd: aScore - hScore, gf: aScore },
      };
    }

    rankTeams(simTeams, simH2H).forEach((t, idx) => {
      possiblePositions[t.name].add(idx + 1);
    });
  }

  return possiblePositions;
}

function computeQualifiers(groups, fixtureData = {}) {
  const winners = {}, runnersUp = {}, allThirds = [], completedGroups = new Set();
  const guaranteedWinners = new Set(), guaranteedRunnersUp = new Set();
  const guaranteedThirds = new Set(), guaranteedFourths = new Set();
  const guaranteedThrough = new Set();
  groups.forEach((group) => {
    const letter = groupLetter(group);
    if (!letter) return;
    const sorted = sortEntries(group.standings?.entries ?? []);
    const allPlayed3 = sorted.length === 4 && sorted.every(e => (getStats(e).gamesPlayed ?? 0) >= 3);
    if (allPlayed3) completedGroups.add(letter);
    if (sorted[0]) winners[letter] = sorted[0].team?.displayName ?? "";
    if (sorted[1]) runnersUp[letter] = sorted[1].team?.displayName ?? "";

    // Feasibility analysis: mark teams whose position is mathematically locked
    const feasible = computeFeasiblePositions(group, fixtureData);
    if (feasible) {
      Object.entries(feasible).forEach(([teamName, positions]) => {
        if (positions.size === 1 && positions.has(1)) guaranteedWinners.add(teamName);
        if (positions.size === 1 && positions.has(2)) guaranteedRunnersUp.add(teamName);
        if (positions.size === 1 && positions.has(3)) guaranteedThirds.add(teamName);
        if (positions.size === 1 && positions.has(4)) guaranteedFourths.add(teamName);
        // Guaranteed through = all feasible positions are top-2 (may still be 1st or 2nd)
        if (positions.size > 0 && [...positions].every(p => p <= 2)) guaranteedThrough.add(teamName);
      });
    }

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
  const qualifiedThirds = allThirds.slice(0, T.bestThirds);

  // Third-placed teams already certain to finish inside / outside the qualifying places
  const incompleteGroups = GROUP_COUNT - completedGroups.size;
  const thirdConfirmedIn = new Set(), thirdConfirmedOut = new Set();
  allThirds.forEach((t, i) => {
    if (!completedGroups.has(t.group)) return;
    const completedAbove = allThirds.slice(0, i).filter(t2 => completedGroups.has(t2.group)).length;
    if (completedAbove + incompleteGroups < T.bestThirds) thirdConfirmedIn.add(t.name);
    if (completedAbove >= T.bestThirds) thirdConfirmedOut.add(t.name);
  });

  return { winners, runnersUp, allThirds, qualifiedThirds, completedGroups, guaranteedWinners, guaranteedRunnersUp, guaranteedThirds, guaranteedFourths, guaranteedThrough, thirdConfirmedIn, thirdConfirmedOut };
}

export default function GroupsPage() {
  const [standings, setStandings] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("bracket");

  useEffect(() => {
    Promise.all([
      fetchStandings(),
      fetchTournamentEvents(),
    ])
      .then(([s, evs]) => {
        setStandings(s);
        setEvents(evs);
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

  const groups = standingsGroups(standings);
  const allEvents = events ?? [];
  const fixtureData = buildFixtureData(allEvents.filter((e) => roundOf(e) === "group-stage"), groups);
  const qualifiers = computeQualifiers(groups, fixtureData);
  const knockoutEvents = allEvents.filter(isKnockout);

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
            <GroupTable
              key={group.uid ?? group.name}
              group={group}
              guaranteedWinners={qualifiers.guaranteedWinners}
              guaranteedThrough={qualifiers.guaranteedThrough}
              guaranteedThirds={qualifiers.guaranteedThirds}
              guaranteedFourths={qualifiers.guaranteedFourths}
              thirdConfirmedIn={qualifiers.thirdConfirmedIn}
              thirdConfirmedOut={qualifiers.thirdConfirmedOut}
            />
          ))}
          {qualifiers.allThirds.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <ThirdPlaceTable allThirds={qualifiers.allThirds} thirdConfirmedIn={qualifiers.thirdConfirmedIn} thirdConfirmedOut={qualifiers.thirdConfirmedOut} />
            </div>
          )}
        </div>
      )}

      {tab === "fixtures" && (
        <FixturesTab events={knockoutEvents} loading={!events} />
      )}

      {tab === "bracket" && (
        <BracketTab knockoutEvents={knockoutEvents} qualifiers={qualifiers} />
      )}
    </div>
  );
}

function GroupTable({ group, guaranteedWinners = new Set(), guaranteedThrough = new Set(), guaranteedThirds = new Set(), guaranteedFourths = new Set(), thirdConfirmedIn = new Set(), thirdConfirmedOut = new Set() }) {
  const entries = sortEntries(group.standings?.entries ?? []);
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
            const stats = getStats(entry);
            const nameClass = guaranteedWinners.has(teamName)
              ? styles.teamWinner
              : guaranteedThrough.has(teamName)
              ? styles.staticTeamConfirmed
              : thirdConfirmedIn.has(teamName)
              ? styles.staticTeamConfirmed
              : thirdConfirmedOut.has(teamName) || guaranteedFourths.has(teamName)
              ? styles.teamEliminated
              : guaranteedThirds.has(teamName)
              ? styles.teamThird
              : "";
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
                  <span className={`${styles.espnTeamName} ${nameClass}`}>{teamName}</span>
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

function FixturesTab({ events, loading }) {
  if (loading) return <p className={styles.loading}>Loading…</p>;
  if (events.length === 0) return <p className={styles.empty}>No fixtures available.</p>;

  const byDate = {};
  events.forEach((e) => {
    const day = new Date(e.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!byDate[day]) byDate[day] = [];
    byDate[day].push(e);
  });

  return (
    <div className={styles.fixtures}>
      {Object.entries(byDate).map(([day, dayEvents]) => (
        <div key={day}>
          <div className={styles.fixtureDay}>{day}</div>
          {dayEvents.map((event) => (
            <FixtureRow key={event.id} event={event} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FixtureRow({ event }) {
  const competition = event.competitions?.[0];
  const [home, away] = homeAway(event);
  const status = competition?.status;
  const isLive = status?.type?.state === "in";
  const isFinished = status?.type?.completed;

  const homeEntry = findEntry(home?.team?.displayName);
  const awayEntry = findEntry(away?.team?.displayName);

  const venue = competition?.venue;
  const venueName = venue?.fullName;
  const venueCity = venue?.address?.city;
  const venueStr = venueName
    ? (venueCity ? `${venueName}, ${venueCity}` : venueName)
    : null;

  const referee = competition?.officials?.find(
    (o) => o.position?.displayName?.toLowerCase().includes("referee")
  )?.fullName ?? null;

  const metaParts = [];
  if (venueStr) metaParts.push(venueStr);
  if (referee) metaParts.push(`Ref: ${referee}`);

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
        <TeamSlot entry={homeEntry} team={home?.team} score={home?.score} isWinner={home?.winner === true} isLoser={away?.winner === true} />
        <div className={styles.vs}>
          {isFinished || isLive ? (
            <span className={styles.score}>{home?.score} – {away?.score}</span>
          ) : (
            <span className={styles.vsText}>vs</span>
          )}
        </div>
        <TeamSlot entry={awayEntry} team={away?.team} score={away?.score} isWinner={away?.winner === true} isLoser={home?.winner === true} right />
      </div>
      {(competition?.groups?.name || metaParts.length > 0) && (
        <div className={styles.fixtureGroup}>
          {competition?.groups?.name}
          {metaParts.length > 0 && (
            <span className={styles.fixtureMeta}>{competition?.groups?.name ? " · " : ""}{metaParts.join(" · ")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSlot({ entry, team, right, isWinner, isLoser }) {
  const name = team?.displayName ?? team?.shortDisplayName ?? "";
  const badge = entry ? <Flag code={entry.flag} size={24} /> : <img src={team?.logos?.[0]?.href} width={36} height={24} alt="" style={{ objectFit: "contain" }} />;
  return (
    <div className={`${styles.teamSlot} ${right ? styles.right : ""}${isLoser ? ` ${styles.teamLoser}` : ""}`}>
      {!right && badge}
      <div className={styles.slotInfo}>
        <span className={`${styles.slotName}${isWinner ? ` ${styles.teamWinner}` : ""}`}>{name}</span>
        {entry?.person && <span className={styles.slotOwner}>{entry.person}</span>}
      </div>
      {right && badge}
    </div>
  );
}

// Resolve a bracket slot code ("1E", "2C", "3ABCDF") to a team from current standings.
function resolveSlot(code, matchIndex, qualifiers, thirdsByMatch) {
  const { winners, runnersUp, allThirds, qualifiedThirds, completedGroups, guaranteedWinners, guaranteedRunnersUp } = qualifiers;
  const label = slotLabel(code);
  const { pos, groups } = parseSlot(code);
  if (pos !== 3) {
    const team = (pos === 1 ? winners : runnersUp)[groups] || null;
    const guaranteedSet = pos === 1 ? guaranteedWinners : guaranteedRunnersUp;
    return { label, team, guaranteed: completedGroups.has(groups) || (team ? guaranteedSet.has(team) : false) };
  }
  const allGroupsDone = completedGroups.size >= GROUP_COUNT;
  const team = thirdsByMatch[matchIndex] ?? null;
  if (team) return { label, team, tentative: qualifiedThirds.length < T.bestThirds || !allGroupsDone, guaranteed: allGroupsDone };
  // Fallback before the qualifiers are known: best third from an eligible group
  const fallback = allThirds.find((t) => groups.includes(t.group));
  if (fallback) return { label, team: fallback.name, tentative: true };
  return { label, team: null };
}

function ThirdPlaceTable({ allThirds, thirdConfirmedIn, thirdConfirmedOut }) {
  if (allThirds.length === 0) return null;
  return (
    <div className={styles.thirdsTable}>
      <h3 className={styles.bracketRoundTitle}>Best 3rd-Place Rankings</h3>
      <p className={styles.thirdsNote}>Top {T.bestThirds} qualify for {T.rounds[0].label} · Ranked by Pts → GD → GF</p>
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
            const confirmedIn  = thirdConfirmedIn.has(t.name);
            const confirmedOut = thirdConfirmedOut.has(t.name);
            const rowClass = confirmedIn ? styles.qualifyingRow : confirmedOut ? styles.eliminatedRow : "";
            return (
              <tr key={t.name} className={`${rowClass} ${i === T.bestThirds ? styles.cutoffRow : ""}`}>
                <td className={styles.teamCell}>
                  <span className={styles.thirdsRank}>{i + 1}</span>
                  {entry && <Flag code={entry.flag} size={18} />}
                  <span className={styles.espnTeamName}>{t.name}</span>
                  {confirmedIn && <span className={styles.qualifyBadge}>Q</span>}
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

// Display order (tier) and label for each ESPN round slug
const ROUND_INFO = Object.fromEntries([
  ...T.rounds.map((r, tier) => [r.slug, { tier, label: r.label }]),
  ["3rd-place-match", { tier: T.rounds.length - 1.5, label: "Third-place play-off" }],
]);
const roundInfo = (event) => ROUND_INFO[roundOf(event)] ?? { tier: T.rounds.length, label: "Knockout Stage" };
const roundTitle = (r) => `${r.label} · ${r.when}`;

function BracketTab({ knockoutEvents, qualifiers }) {
  const [bracketView, setBracketView] = useState('wheel');
  const thirdsByMatch = assignThirds(qualifiers.qualifiedThirds.map((t) => ({ group: t.group, team: t.name })));
  const resolvedFirst = T.bracket.map((m, i) => ({
    home: resolveSlot(m.home, i, qualifiers, thirdsByMatch),
    away: resolveSlot(m.away, i, qualifiers, thirdsByMatch),
  }));

  if (knockoutEvents.length > 0) {
    // Build lookup: sorted pair key → winner display name (from completed events).
    // Use winner flag only (safe for ET/pens) — ESPN doesn't set status.type.completed
    // on knockout events so we can't use that as a completion guard.
    const matchWinners = {};
    knockoutEvents.forEach((e) => {
      const [home, away] = homeAway(e);
      if (!home || !away) return;
      const homeName = home.team?.displayName ?? "";
      const awayName = away.team?.displayName ?? "";
      let winner = null;
      if (home.winner === true) {
        winner = homeName;
      } else if (away.winner === true) {
        winner = awayName;
      } else {
        // ESPN sometimes omits winner:true on completed knockout events.
        // Fall back to score comparison for matches that kicked off 3+ hours ago.
        const eventMs = Date.parse(e.date);
        if (!isNaN(eventMs) && eventMs < Date.now() - 3 * 60 * 60 * 1000) {
          const hs = parseInt(home.score ?? '', 10);
          const as = parseInt(away.score ?? '', 10);
          if (!isNaN(hs) && !isNaN(as) && hs !== as) {
            winner = hs > as ? homeName : awayName;
          }
        }
      }
      if (!winner) return;
      matchWinners[pairKey(homeName, awayName)] = winner;
    });

    function pairWinner(a, b) {
      if (!a || !b) return null;
      const w = matchWinners[pairKey(a, b)];
      if (!w) return null;
      const wk = teamKey(w);
      return wk === teamKey(a) ? a : wk === teamKey(b) ? b : null;
    }

    // Once ESPN lists the real first-round fixture, prefer it over our standings-derived guess —
    // the "Best 3rd" slot prediction can differ from the official draw's actual tiebreak
    // result, and unlike list view (which reads real events directly), the wheel bracket
    // only ever sees this resolved/guessed data.
    const firstRoundEvents = knockoutEvents.filter(isFirstRound);
    function findFirstRoundMatch(slot) {
      const certain = slot.home.guaranteed ? slot.home : slot.away.guaranteed ? slot.away : null;
      if (!certain?.team) return null;
      const certainKey = teamKey(certain.team);
      return firstRoundEvents.find((e) => {
        const [home, away] = homeAway(e);
        const hk = teamKey(home?.team?.displayName ?? "");
        const ak = teamKey(away?.team?.displayName ?? "");
        return hk === certainKey || ak === certainKey;
      }) ?? null;
    }
    const displayFirst = resolvedFirst.map((slot) => {
      const match = findFirstRoundMatch(slot);
      if (!match) return slot;
      const [home, away] = homeAway(match);
      const actualHome = home?.team?.displayName;
      const actualAway = away?.team?.displayName;
      if (!actualHome || !actualAway) return slot;
      const homeMatchesGuess = teamKey(actualHome) === teamKey(slot.home.team);
      return homeMatchesGuess
        ? { home: { ...slot.home, team: actualHome, guaranteed: true }, away: { ...slot.away, team: actualAway, guaranteed: true } }
        : { home: { ...slot.home, team: actualAway, guaranteed: true }, away: { ...slot.away, team: actualHome, guaranteed: true } };
    });

    // winners[r][k] = winner of match k in round r (null if not played), down to the champion
    const winners = [displayFirst.map(({ home, away }) => pairWinner(home.team, away.team))];
    while (winners.at(-1).length > 1) winners.push(pairUp(winners.at(-1)).map(([a, b]) => pairWinner(a, b)));

    const byRound = {};
    knockoutEvents.forEach((e) => {
      (byRound[roundInfo(e).label] ??= []).push(e);
    });
    const maxTier = Math.max(...knockoutEvents.map((e) => roundInfo(e).tier), -1);

    // bracketSlot: produce display info for a team slot
    function bracketSlot(name, fallback) {
      if (name) return { name, entry: findEntry(name), confirmed: true };
      return { name: fallback, entry: null, confirmed: false };
    }

    // Label for the unknown winner of match k in round r: "A / B" once both sides are known
    function winnerFallback(r, k) {
      if (r === 0) {
        const { home, away } = displayFirst[k];
        return `${home.team || home.label} / ${away.team || away.label}`;
      }
      const [a, b] = pairUp(winners[r - 1])[k];
      return a && b ? `${a} / ${b}` : "TBD";
    }

    // Rounds after the first, each with its matchups (winners of the previous round, paired)
    const futureRounds = T.rounds.slice(1).map((round, r) => ({
      tier: r + 1,
      label: roundTitle(round),
      pairs: pairUp(winners[r].map((w, k) => bracketSlot(w, winnerFallback(r, k)))),
    }));

    function renderFutureMatch(teamA, teamB, key) {
      return (
        <div key={key} className={styles.staticMatch}>
          <div className={styles.staticTeams}>
            <div className={styles.staticSlot}>
              {teamA.entry && <Flag code={teamA.entry.flag} size={18} />}
              <div>
                <div className={`${styles.staticTeam} ${teamA.confirmed ? styles.staticTeamConfirmed : ""}`}>{teamA.name}</div>
                {teamA.entry?.person && <div className={styles.staticOwner}>{teamA.entry.person}</div>}
              </div>
            </div>
            <span className={styles.staticVs}>vs</span>
            <div className={`${styles.staticSlot} ${styles.staticSlotRight}`}>
              <div style={{ textAlign: "right" }}>
                <div className={`${styles.staticTeam} ${teamB.confirmed ? styles.staticTeamConfirmed : ""}`}>{teamB.name}</div>
                {teamB.entry?.person && <div className={styles.staticOwner}>{teamB.entry.person}</div>}
              </div>
              {teamB.entry && <Flag code={teamB.entry.flag} size={18} />}
            </div>
          </div>
        </div>
      );
    }

    const futureToShow = futureRounds.filter(r => r.tier > maxTier);

    const viewToggle = (
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['list', 'wheel'].map(v => (
          <button key={v} onClick={() => setBracketView(v)}
            style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
              background: bracketView === v ? '#3b82f6' : '#1e293b',
              color: bracketView === v ? '#fff' : '#94a3b8',
              fontWeight: bracketView === v ? '600' : '400',
            }}>
            {v === 'list' ? 'List view' : 'Wheel view'}
          </button>
        ))}
      </div>
    );

    if (bracketView === 'wheel') {
      return (
        <div className={styles.bracket}>
          {viewToggle}
          <CircularBracket firstRound={displayFirst} winners={winners} />
        </div>
      );
    }

    return (
      <div className={styles.bracket}>
        {viewToggle}
        {Object.entries(byRound)
          .sort(([, a], [, b]) => roundInfo(a[0]).tier - roundInfo(b[0]).tier)
          .map(([round, events]) => (
          <div key={round} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{round}</h3>
            <div className={styles.bracketMatches}>
              {events.map((event) => <FixtureRow key={event.id} event={event} />)}
            </div>
          </div>
        ))}
        {futureToShow.map((r, idx) => (
          <div key={r.tier} className={styles.bracketRound}>
            <h3 className={styles.bracketRoundTitle}>{r.label}</h3>
            {idx === 0
              ? <div className={styles.bracketMatches}>
                  {r.pairs.map(([teamA, teamB], i) => renderFutureMatch(teamA, teamB, i))}
                </div>
              : <p className={styles.bracketTbd}>Teams determined after {futureToShow[idx - 1].label.split(" ·")[0]}</p>
            }
          </div>
        ))}
      </div>
    );
  }


  return (
    <div className={styles.bracket}>
      <div className={styles.bracketBanner}>
        <span>Knockout stage begins with the {roundTitle(T.rounds[0])} · <strong>*</strong> = provisional based on current standings</span>
      </div>
      <div className={styles.bracketRound}>
        <h3 className={styles.bracketRoundTitle}>{T.rounds[0].label}</h3>
        <div className={styles.bracketMatches}>
          {resolvedFirst.map(({ home, away }, i) => {
            const m = T.bracket[i];
            const homeEntry = home.team ? findEntry(home.team) : null;
            const awayEntry = away.team ? findEntry(away.team) : null;
            return (
              <div key={`${m.date}-${m.home}`} className={styles.staticMatch}>
                <div className={styles.staticMeta}>{m.date} · {m.venue}</div>
                <div className={styles.staticTeams}>
                  <div className={styles.staticSlot}>
                    {homeEntry && <Flag code={homeEntry.flag} size={18} />}
                    <div>
                      <div className={`${styles.staticTeam} ${home.guaranteed ? styles.staticTeamConfirmed : ""}`}>{home.team || home.label}{home.tentative ? <span className={styles.tentative}> *</span> : null}</div>
                      {home.team && <div className={styles.staticSub}>{home.label}</div>}
                      {homeEntry?.person && <div className={styles.staticOwner}>{homeEntry.person}</div>}
                    </div>
                  </div>
                  <span className={styles.staticVs}>vs</span>
                  <div className={`${styles.staticSlot} ${styles.staticSlotRight}`}>
                    <div style={{ textAlign: "right" }}>
                      <div className={`${styles.staticTeam} ${away.guaranteed ? styles.staticTeamConfirmed : ""}`}>{away.team || away.label}{away.tentative ? <span className={styles.tentative}> *</span> : null}</div>
                      {away.team && <div className={styles.staticSub}>{away.label}</div>}
                      {awayEntry?.person && <div className={styles.staticOwner}>{awayEntry.person}</div>}
                    </div>
                    {awayEntry && <Flag code={awayEntry.flag} size={18} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {T.rounds.slice(1).map((round, r) => (
        <div key={round.slug} className={styles.bracketRound}>
          <h3 className={styles.bracketRoundTitle}>{roundTitle(round)}</h3>
          <p className={styles.bracketTbd}>Teams determined after {T.rounds[r].label}</p>
        </div>
      ))}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
