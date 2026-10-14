import T from '../tournament';
import { EXIT_ORDER, parseSlot, pairUp, assignThirds } from './bracket';

const rawProbs = T.draw.map(e => 1 / e.odds);
const probSum  = rawProbs.reduce((a, b) => a + b, 0);
const TEAMS    = T.draw.map((e, i) => ({ ...e, p: rawProbs[i] / probSum }));
const teamMap  = Object.fromEntries(TEAMS.map(t => [t.team, t]));

// Knuth Poisson sampler
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function matchSim(a, b) {
  return Math.random() < a.p / (a.p + b.p) ? a : b;
}

// MD schedule for a 4-team round-robin (indices into group names array)
export const GROUP_SCHEDULE = [
  [[0,1],[2,3]], // MD1
  [[0,2],[1,3]], // MD2
  [[0,3],[1,2]], // MD3
];

// Seed from real standings, simulate only remaining matchdays.
// eliminatedTeams: Set of team names that cannot finish in the top 2 (H2H-locked out).
function simPartialGroup(names, overrideTeams, matchdaysPlayed, gottPairs, tm, eliminatedTeams = new Set()) {
  const om = Object.fromEntries(overrideTeams.map(t => [t.teamName, t]));
  const teams = names.map(n => tm[n]);
  const pts = names.map(n => om[n]?.pts ?? 0);
  const gd  = names.map(n => om[n]?.gd  ?? 0);
  const gf  = names.map(n => om[n]?.gf  ?? 0);
  for (let md = matchdaysPlayed; md < 3; md++) {
    for (const [i, j] of GROUP_SCHEDULE[md]) {
      gottPairs.push([teams[i], teams[j]]);
      const iWins = Math.random() < teams[i].p / (teams[i].p + teams[j].p);
      let gi = poisson(1.3), gj = poisson(1.3);
      if (iWins && gi <= gj) gi = gj + 1;
      else if (!iWins && gj <= gi) gj = gi + 1;
      pts[iWins ? i : j] += 3;
      gf[i] += gi; gf[j] += gj;
      gd[i] += gi - gj; gd[j] += gj - gi;
    }
  }
  const idx = [0,1,2,3].sort((a,b) =>
    (pts[b]-pts[a]) || (gd[b]-gd[a]) || (gf[b]-gf[a]) || (Math.random()-0.5)
  );
  if (eliminatedTeams.size > 0) {
    const top = idx.filter(i => !eliminatedTeams.has(names[i]));
    const bot = idx.filter(i =>  eliminatedTeams.has(names[i]));
    return [...top, ...bot].map(i => ({ team: teams[i], pts: pts[i], gd: gd[i], gf: gf[i] }));
  }
  return idx.map(i => ({ team: teams[i], pts: pts[i], gd: gd[i], gf: gf[i] }));
}

// groupOverrides: { letter: { teams:[{teamName,pts,gd,gf}], complete:bool, matchdaysPlayed:int } }
// oddsOverrides: { teamName: decimalOdds } — current bookmaker odds; affects only match-sim
//   probabilities (t.p). Pre-tournament t.odds is preserved for "worst team" prize calculations.
// knockoutResults: { "teama|teamb": "winner" } — pair-keyed confirmed knockout results (case-insensitive)
// thirdPlaceOverrides: { bracketMatchIndex: teamName } — real "Best 3rd" opponents read directly
// from ESPN's own first-round fixtures. Without an official allocation table assignThirds() can
// only guess, so once ESPN has published every wildcard slot we bypass it entirely rather than
// risk a wrong pairing that's then wrong in every single simulation run.
export function runSimulations(n = 10000, groupOverrides = {}, oddsOverrides = null, knockoutResults = {}, thirdPlaceOverrides = {}) {
  const useThirdOverrides = Object.keys(thirdPlaceOverrides).length === T.bestThirds;
  const gottConfig = T.gott;
  // Build local team list: override p (probability) only, keeping odds (pre-tournament) intact
  let localTeams = TEAMS;
  // Per-team count of confirmed knockout wins (keyed lower-case). A team with >N wins has
  // already advanced past the round that requires N prior wins, so it must advance in the sim
  // even when assignThirds() pairs it with a different opponent than the real bracket.
  const koWinCount = {};
  for (const w of Object.values(knockoutResults)) {
    const k = (w ?? "").toLowerCase();
    koWinCount[k] = (koWinCount[k] ?? 0) + 1;
  }
  // Teams confirmed eliminated after winning at least one knockout match. Prevents confirmed
  // losers advancing in mismatched bracket pairings (e.g. Germany lost R16 but assignThirds()
  // pairs Germany with a 0-win sim opponent, so neither win-count condition fires).
  // We only mark a team as a confirmed loser if they also have confirmed wins —
  // a team with 0 wins that appears here is almost certainly an ESPN pre-population
  // artefact for an unplayed match (e.g. Colombia's R32 slot filled with a placeholder
  // result). Teams genuinely eliminated in their first knockout match are covered by
  // the exact pair-key check in simRound and don't need this extra guard.
  const koLosers = new Set();
  for (const [pairKey, winner] of Object.entries(knockoutResults)) {
    const [a, b] = pairKey.split('|');
    const loser = a !== winner ? a : b;
    if ((koWinCount[loser] ?? 0) > 0) koLosers.add(loser);
  }
  let localTeamMap = teamMap;
  if (oddsOverrides && Object.keys(oddsOverrides).length > 0) {
    const rawP = T.draw.map(e => 1 / (oddsOverrides[e.team] ?? e.odds));
    const sum = rawP.reduce((a, b) => a + b, 0);
    localTeams = TEAMS.map((e, i) => ({ ...e, p: rawP[i] / sum }));
    localTeamMap = Object.fromEntries(localTeams.map(t => [t.team, t]));
  }

  const personTotal = {};
  const personBreakdown = {};
  const personBreakdownTeam = {};
  const teamTotal = {};
  const people = [...new Set(localTeams.map(t => t.person).filter(Boolean))];
  people.forEach(p => {
    personTotal[p] = 0;
    personBreakdown[p] = Object.fromEntries(T.prizes.map(prize => [prize.key, 0]));
    personBreakdownTeam[p] = {};
  });
  localTeams.forEach(t => { teamTotal[t.team] = 0; });

  // Goal quality sampler: power distribution calibrated so P(quality > currentBest) = perGameProb
  const gottSample = (() => {
    if (gottConfig?.quality > 0 && gottConfig?.perGameProb > 0) {
      const exp = Math.log(1 - gottConfig.perGameProb) / Math.log(gottConfig.quality);
      return () => Math.pow(Math.random(), 1 / exp);
    }
    return Math.random; // fallback: uniform
  })();

  for (let s = 0; s < n; s++) {
    const exit = {};
    const groupRank = {};
    const grpResult = {};
    const allThirds = [];
    const gottPairs = [];

    for (const [letter, names] of Object.entries(T.groups)) {
      let sorted;
      const ov = groupOverrides[letter];
      if (ov?.complete) {
        sorted = ov.teams
          .map(({ teamName, pts, gd, gf }) => ({ team: localTeamMap[teamName], pts, gd, gf: gf ?? 0 }))
          .filter(r => r.team);
      } else if (ov) {
        sorted = simPartialGroup(names, ov.teams, ov.matchdaysPlayed, gottPairs, localTeamMap, ov.eliminatedTeams ?? new Set());
      } else {
        sorted = simPartialGroup(names, [], 0, gottPairs, localTeamMap);
      }
      grpResult[letter] = sorted;
      sorted.forEach(r => { groupRank[r.team.team] = { pts: r.pts, gd: r.gd, gf: r.gf ?? 0 }; });
      if (sorted[3]) exit[sorted[3].team.team] = 'group';
      if (sorted[2]) allThirds.push({ team: sorted[2].team, group: letter, pts: sorted[2].pts, gd: sorted[2].gd, gf: sorted[2].gf ?? 0 });
    }

    allThirds.sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf || a.team.p-b.team.p);
    allThirds.slice(T.bestThirds).forEach(t => { exit[t.team.team] = 'group'; });

    const thirdsMap = useThirdOverrides ? {} : assignThirds(allThirds.slice(0, T.bestThirds));
    const slotTeam = (code, i) => {
      const { pos, groups } = parseSlot(code);
      if (pos !== 3) return grpResult[groups][pos - 1].team;
      return useThirdOverrides ? (localTeamMap[thirdPlaceOverrides[i]] ?? null) : (thirdsMap[i] ?? null);
    };

    // Each returns [winner, loser]. Confirmed result by sorted "teama|teamb" key, if known.
    const confirmedResult = (a, b) => {
      const aLower = a.team.toLowerCase(), bLower = b.team.toLowerCase();
      const confirmed = knockoutResults[[aLower, bLower].sort().join('|')];
      return confirmed === aLower ? [a, b] : confirmed === bLower ? [b, a] : null;
    };
    // Win-count fallback: assignThirds() may pair a confirmed team with a different opponent than
    // the real bracket, so the exact key misses. For each round we know how many prior knockout
    // wins a team must already have to reach it (its round index). If one team has more
    // confirmed wins than that and the other does not, the confirmed team advances. Likewise a
    // confirmed loser facing a team that isn't one is eliminated.
    const forcedResult = (a, b, prior) => {
      const aLower = a.team.toLowerCase(), bLower = b.team.toLowerCase();
      const aWins = koWinCount[aLower] ?? 0, bWins = koWinCount[bLower] ?? 0;
      if (aWins > prior && bWins <= prior) return [a, b];
      if (bWins > prior && aWins <= prior) return [b, a];
      if (koLosers.has(aLower) && !koLosers.has(bLower)) return [b, a];
      if (koLosers.has(bLower) && !koLosers.has(aLower)) return [a, b];
      return null;
    };
    const simulated = (a, b) => {
      gottPairs.push([a, b]);
      const w = matchSim(a, b);
      return [w, w === a ? b : a];
    };

    // Play every round but the final; each round's winners pair up for the next.
    let pairs = T.bracket.map((m, i) => [slotTeam(m.home, i), slotTeam(m.away, i)]);
    let losers = [];
    T.rounds.slice(0, -1).forEach((round, prior) => {
      const results = pairs.map(([a, b]) => !a || !b ? [a ?? b, null]
        : confirmedResult(a, b) ?? forcedResult(a, b, prior) ?? simulated(a, b));
      results.forEach(([, l]) => { if (l) exit[l.team] = round.slug; });
      losers = results.map(([, l]) => l);
      pairs = pairUp(results.map(([w]) => w));
    });
    if (T.thirdPlaceMatch && losers[0] && losers[1]) {
      const [w, l] = confirmedResult(losers[0], losers[1]) ?? simulated(losers[0], losers[1]);
      exit[w.team] = '3rd'; exit[l.team] = '4th';
    }
    const [fa, fb] = pairs[0];
    if (fa && fb) {
      const [w, l] = confirmedResult(fa, fb) ?? simulated(fa, fb);
      exit[w.team] = 'winner'; exit[l.team] = 'runnerUp';
    }

    const add = (team, { key, amount }) => {
      if (team?.person) {
        personTotal[team.person] += amount;
        personBreakdown[team.person][key] += amount;
        teamTotal[team.team] += amount;
        const pt = personBreakdownTeam[team.person];
        if (!pt[key]) pt[key] = {};
        pt[key][team.team] = (pt[key][team.team] ?? 0) + amount;
      }
    };
    const exitRank = t => EXIT_ORDER.indexOf(exit[t.team] ?? 'group');
    const byExit = r => localTeams.filter(t => exit[t.team]===r);
    const reached = round => localTeams.filter(t => exitRank(t) >= EXIT_ORDER.indexOf(round));
    // worst() uses t.odds (pre-tournament) — intentional, current odds not used here
    const worst = ts => ts.length ? ts.reduce((a,b) => b.odds>a.odds ? b : b.odds===a.odds && Math.random()<0.5 ? b : a) : null;

    // Player of the Tournament: a semi-finalist, weighted by strength
    const pott = () => {
      const last4 = reached(T.rounds.at(-2).slug);
      if (!last4.length) return null;
      let r = Math.random() * last4.reduce((s,t) => s+t.p, 0);
      for (const t of last4) { r-=t.p; if (r<=0) return t; }
      return last4[last4.length-1];
    };

    // GOTT: sample one goal quality per game; best across all games wins
    const gott = () => {
      let gottBest = gottConfig?.quality ?? -1;
      let gottWinner = gottConfig ? (localTeamMap[gottConfig.team] ?? null) : null;
      for (const [a, b] of gottPairs) {
        const q = gottSample();
        if (q > gottBest) {
          gottBest = q;
          gottWinner = Math.random() < 0.5 ? a : b;
        }
      }
      return gottWinner;
    };

    const worstOverall = () => localTeams.reduce((best,t) => {
      const s=groupRank[t.team]; if(!s) return best;
      const sb=groupRank[best?.team]; if(!sb) return t;
      if(s.pts!==sb.pts) return s.pts<sb.pts?t:best;
      if(s.gd!==sb.gd) return s.gd<sb.gd?t:best;
      if(s.gf!==sb.gf) return s.gf<sb.gf?t:best;
      return Math.random()<0.5?t:best; // random tiebreak if genuinely equal
    }, null);

    for (const prize of T.prizes) {
      const team = {
        winner:       () => byExit('winner')[0],
        runnerUp:     () => byExit('runnerUp')[0],
        third:        () => byExit('3rd')[0],
        pott,
        gott,
        worstOverall,
        worstReached: () => worst(reached(prize.round)),
      }[prize.type]();
      add(team, prize);
    }
  }

  return {
    personEV: Object.fromEntries(Object.entries(personTotal).map(([p,v]) => [p, +(v/n).toFixed(2)])),
    personBreakdown: Object.fromEntries(Object.entries(personBreakdown).map(([p,d]) => [
      p, Object.fromEntries(Object.entries(d).map(([k,v]) => [k, +(v/n).toFixed(2)]))
    ])),
    personBreakdownTeam: Object.fromEntries(Object.entries(personBreakdownTeam).map(([p,keys]) => [
      p, Object.fromEntries(Object.entries(keys).map(([k,teams]) => [
        k, Object.fromEntries(Object.entries(teams).map(([t,v]) => [t, +(v/n).toFixed(2)]))
      ]))
    ])),
    teamEV: Object.fromEntries(Object.entries(teamTotal).map(([t,v]) => [t, +(v/n).toFixed(2)])),
  };
}
