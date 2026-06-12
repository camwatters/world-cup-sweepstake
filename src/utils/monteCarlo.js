import { draw } from '../data/draw';

// Official 2026 World Cup group draw (using draw.js team names)
const GROUPS = {
  A: ['Mexico', 'Czech Republic', 'South Korea', 'South Africa'],
  B: ['Canada', 'Bosnia and Herzegovina', 'Switzerland', 'Qatar'],
  C: ['Brazil', 'Scotland', 'Haiti', 'Morocco'],
  D: ['Paraguay', 'Turkey', 'Australia', 'USA'],
  E: ['Ecuador', 'Germany', 'Ivory Coast', 'Curacao'],
  F: ['Netherlands', 'Sweden', 'Japan', 'Tunisia'],
  G: ['Belgium', 'Iran', 'Egypt', 'New Zealand'],
  H: ['Spain', 'Uruguay', 'Saudi Arabia', 'Cape Verde'],
  I: ['Norway', 'France', 'Senegal', 'Iraq'],
  J: ['Argentina', 'Austria', 'Algeria', 'Jordan'],
  K: ['Colombia', 'Portugal', 'Uzbekistan', 'DR Congo'],
  L: ['England', 'Croatia', 'Panama', 'Ghana'],
};

// R32 bracket: [homeSlot, awaySlot]
// type 'w'=winner, 'r'=runner-up, '3'=best-3rd (eligible=string of group letters)
const R32 = [
  [{ t: 'r', g: 'A' }, { t: 'r', g: 'B' }],       // M73, idx 0
  [{ t: 'w', g: 'E' }, { t: '3', e: 'ABCDF' }],    // M74, idx 1
  [{ t: 'w', g: 'F' }, { t: 'r', g: 'C' }],         // M75, idx 2
  [{ t: 'w', g: 'C' }, { t: 'r', g: 'F' }],         // M76, idx 3
  [{ t: 'w', g: 'I' }, { t: '3', e: 'CDFGH' }],    // M77, idx 4
  [{ t: 'r', g: 'E' }, { t: 'r', g: 'I' }],         // M78, idx 5
  [{ t: 'w', g: 'A' }, { t: '3', e: 'CEFHI' }],    // M79, idx 6
  [{ t: 'w', g: 'L' }, { t: '3', e: 'EHIJK' }],    // M80, idx 7
  [{ t: 'w', g: 'D' }, { t: '3', e: 'BEFIJ' }],    // M81, idx 8
  [{ t: 'w', g: 'G' }, { t: '3', e: 'AEHIJ' }],    // M82, idx 9
  [{ t: 'r', g: 'K' }, { t: 'r', g: 'L' }],         // M83, idx 10
  [{ t: 'w', g: 'H' }, { t: 'r', g: 'J' }],         // M84, idx 11
  [{ t: 'w', g: 'B' }, { t: '3', e: 'EFGIJ' }],    // M85, idx 12
  [{ t: 'w', g: 'J' }, { t: 'r', g: 'H' }],         // M86, idx 13
  [{ t: 'w', g: 'K' }, { t: '3', e: 'DEIJL' }],    // M87, idx 14
  [{ t: 'r', g: 'D' }, { t: 'r', g: 'G' }],         // M88, idx 15
];

// R16 pairs (indices into r32Winners)
const R16 = [[1,4],[0,2],[3,5],[6,7],[10,11],[8,9],[13,15],[12,14]];
// QF pairs (indices into r16Winners)
const QF  = [[0,1],[4,5],[2,3],[6,7]];
// SF pairs (indices into qfWinners)
const SF  = [[0,1],[2,3]];

// Normalize bookmaker odds to true win probabilities
const rawProbs = draw.map(e => 1 / e.odds);
const probSum  = rawProbs.reduce((a, b) => a + b, 0);
const TEAMS    = draw.map((e, i) => ({ ...e, p: rawProbs[i] / probSum }));
const teamMap  = Object.fromEntries(TEAMS.map(t => [t.team, t]));

function match(a, b) {
  return Math.random() < a.p / (a.p + b.p) ? a : b;
}

function simGroup(names) {
  const teams = names.map(n => teamMap[n]);
  const pts = [0, 0, 0, 0], gd = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.random() < teams[i].p / (teams[i].p + teams[j].p)) {
        pts[i] += 3; gd[i]++; gd[j]--;
      } else {
        pts[j] += 3; gd[j]++; gd[i]--;
      }
    }
  }
  const idx = [0,1,2,3].sort((a, b) =>
    (pts[b] - pts[a]) || (gd[b] - gd[a]) || (Math.random() - 0.5)
  );
  return idx.map(i => ({ team: teams[i], pts: pts[i], gd: gd[i] }));
}

function assignThirds(best8, r32Results) {
  // Build slot list: {matchIdx, slotPos (0=home/1=away), eligible}
  const slots = [];
  R32.forEach((match, i) => {
    match.forEach((slot, pos) => {
      if (slot.t === '3') slots.push({ i, pos, e: slot.e });
    });
  });

  // Sort slots by fewest eligible qualifying thirds (most constrained first)
  const remaining = [...best8]; // [{team, group, pts, gd}]
  slots.sort((a, b) => {
    const ca = remaining.filter(t => a.e.includes(t.group)).length;
    const cb = remaining.filter(t => b.e.includes(t.group)).length;
    return ca - cb;
  });

  const assigned = {}; // matchIdx -> team (for the 3rd-place slot)
  for (const slot of slots) {
    const candidates = remaining.filter(t => slot.e.includes(t.group));
    const pick = candidates.length > 0 ? candidates[0] : remaining[0];
    if (pick) {
      assigned[slot.i] = { team: pick.team, pos: slot.pos };
      remaining.splice(remaining.indexOf(pick), 1);
    }
  }
  return assigned;
}

export function runSimulations(n = 10000) {
  const personTotal = {};
  const people = [...new Set(TEAMS.map(t => t.person).filter(Boolean))];
  people.forEach(p => { personTotal[p] = 0; });

  for (let s = 0; s < n; s++) {
    const exit = {}; // team name -> exit round
    const groupRank = {}; // team name -> {pts, gd}

    // ---- Group stage ----
    const grpResult = {}; // letter -> sorted [{team, pts, gd}]
    const allThirds = [];

    for (const [letter, names] of Object.entries(GROUPS)) {
      const sorted = simGroup(names);
      grpResult[letter] = sorted;
      sorted.forEach((r, i) => { groupRank[r.team.team] = { pts: r.pts, gd: r.gd, pos: i }; });
      exit[sorted[3].team.team] = 'group'; // 4th eliminated
      allThirds.push({ team: sorted[2].team, group: letter, pts: sorted[2].pts, gd: sorted[2].gd });
    }

    // Best 8 thirds by pts → gd → odds (worst = highest odds)
    allThirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || a.team.p - b.team.p);
    const best8 = allThirds.slice(0, 8);
    allThirds.slice(8).forEach(t => { exit[t.team.team] = 'group'; });

    // ---- Build R32 bracket ----
    const thirdsMap = assignThirds(best8, grpResult);
    const r32Pairs = R32.map((slots, i) => {
      const get = (slot, pos) => {
        if (slot.t === 'w') return grpResult[slot.g][0].team;
        if (slot.t === 'r') return grpResult[slot.g][1].team;
        return thirdsMap[i]?.team ?? null;
      };
      return [get(slots[0], 0), get(slots[1], 1)];
    });

    function simRound(pairs, round) {
      return pairs.map(([a, b]) => {
        if (!a) return b;
        if (!b) return a;
        const w = match(a, b);
        const l = w === a ? b : a;
        exit[l.team] = round;
        return w;
      });
    }

    const r32W = simRound(r32Pairs, 'r32');
    const r16W = simRound(R16.map(([a, b]) => [r32W[a], r32W[b]]), 'r16');
    const qfW  = simRound(QF.map(([a, b]) => [r16W[a], r16W[b]]), 'qf');
    const sfW  = [];
    const sfL  = [];
    SF.forEach(([a, b]) => {
      const ta = qfW[a], tb = qfW[b];
      if (!ta || !tb) { sfW.push(ta ?? tb); return; }
      const w = match(ta, tb), l = w === ta ? tb : ta;
      exit[l.team] = 'sf'; sfW.push(w); sfL.push(l);
    });

    // 3rd place play-off
    if (sfL.length === 2) {
      const w = match(sfL[0], sfL[1]), l = w === sfL[0] ? sfL[1] : sfL[0];
      exit[w.team] = '3rd'; exit[l.team] = '4th';
    }

    // Final
    if (sfW[0] && sfW[1]) {
      const w = match(sfW[0], sfW[1]), l = w === sfW[0] ? sfW[1] : sfW[0];
      exit[w.team] = 'winner'; exit[l.team] = 'final';
    }

    // ---- Prize assignments ----
    const add = (team, amt) => { if (team?.person) personTotal[team.person] += amt; };

    const byExit = round => TEAMS.filter(t => exit[t.team] === round);
    const worstOdds = teams => teams.length ? teams.reduce((a, b) => a.odds > b.odds ? a : b) : null;

    // Main prizes
    add(byExit('winner')[0], 200);
    add(byExit('final')[0], 80);
    add(byExit('3rd')[0], 40);

    // Player of Tournament: random semi-finalist weighted by probability
    const last4 = [...byExit('sf'), ...byExit('4th'), ...byExit('final'), ...byExit('winner'), ...byExit('3rd')];
    if (last4.length) {
      const tot = last4.reduce((s, t) => s + t.p, 0);
      let r = Math.random() * tot;
      for (const t of last4) { r -= t.p; if (r <= 0) { add(t, 40); break; } }
    }

    // Goal of Tournament: uniform random across all 48
    add(TEAMS[Math.floor(Math.random() * TEAMS.length)], 40);

    // Consolation prizes — highest-odds team at each elimination stage
    add(worstOdds(byExit('group')), 20); // worst to exit groups
    add(worstOdds(byExit('r32')),   20); // worst to reach L16
    add(worstOdds(byExit('r16')),   20); // worst to reach QFs

    // Worst overall: min pts → min gd → max odds among all group-stage teams
    const worstOverall = TEAMS.reduce((best, t) => {
      const s = groupRank[t.team]; if (!s) return best;
      const sb = groupRank[best?.team];
      if (!sb) return t;
      if (s.pts !== sb.pts) return s.pts < sb.pts ? t : best;
      if (s.gd !== sb.gd) return s.gd < sb.gd ? t : best;
      return t.odds > best.odds ? t : best;
    }, null);
    add(worstOverall, 20);
  }

  // Average over n simulations
  return Object.fromEntries(Object.entries(personTotal).map(([p, v]) => [p, +(v / n).toFixed(2)]));
}
