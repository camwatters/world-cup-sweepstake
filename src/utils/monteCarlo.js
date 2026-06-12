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
const R32 = [
  [{ t: 'r', g: 'A' }, { t: 'r', g: 'B' }],
  [{ t: 'w', g: 'E' }, { t: '3', e: 'ABCDF' }],
  [{ t: 'w', g: 'F' }, { t: 'r', g: 'C' }],
  [{ t: 'w', g: 'C' }, { t: 'r', g: 'F' }],
  [{ t: 'w', g: 'I' }, { t: '3', e: 'CDFGH' }],
  [{ t: 'r', g: 'E' }, { t: 'r', g: 'I' }],
  [{ t: 'w', g: 'A' }, { t: '3', e: 'CEFHI' }],
  [{ t: 'w', g: 'L' }, { t: '3', e: 'EHIJK' }],
  [{ t: 'w', g: 'D' }, { t: '3', e: 'BEFIJ' }],
  [{ t: 'w', g: 'G' }, { t: '3', e: 'AEHIJ' }],
  [{ t: 'r', g: 'K' }, { t: 'r', g: 'L' }],
  [{ t: 'w', g: 'H' }, { t: 'r', g: 'J' }],
  [{ t: 'w', g: 'B' }, { t: '3', e: 'EFGIJ' }],
  [{ t: 'w', g: 'J' }, { t: 'r', g: 'H' }],
  [{ t: 'w', g: 'K' }, { t: '3', e: 'DEIJL' }],
  [{ t: 'r', g: 'D' }, { t: 'r', g: 'G' }],
];

const R16 = [[1,4],[0,2],[3,5],[6,7],[10,11],[8,9],[13,15],[12,14]];
const QF  = [[0,1],[4,5],[2,3],[6,7]];
const SF  = [[0,1],[2,3]];

const rawProbs = draw.map(e => 1 / e.odds);
const probSum  = rawProbs.reduce((a, b) => a + b, 0);
const TEAMS    = draw.map((e, i) => ({ ...e, p: rawProbs[i] / probSum }));
const teamMap  = Object.fromEntries(TEAMS.map(t => [t.team, t]));

function matchSim(a, b) {
  return Math.random() < a.p / (a.p + b.p) ? a : b;
}

function simGroup(names) {
  const teams = names.map(n => teamMap[n]);
  const pts = [0,0,0,0], gd = [0,0,0,0];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.random() < teams[i].p / (teams[i].p + teams[j].p)) {
        pts[i] += 3; gd[i]++; gd[j]--;
      } else {
        pts[j] += 3; gd[j]++; gd[i]--;
      }
    }
  }
  const idx = [0,1,2,3].sort((a,b) => (pts[b]-pts[a]) || (gd[b]-gd[a]) || (Math.random()-0.5));
  return idx.map(i => ({ team: teams[i], pts: pts[i], gd: gd[i] }));
}

function assignThirds(best8) {
  const slots = [];
  R32.forEach((m, i) => m.forEach((slot) => { if (slot.t === '3') slots.push({ i, e: slot.e }); }));
  const remaining = [...best8];
  slots.sort((a, b) => {
    return remaining.filter(t => a.e.includes(t.group)).length
         - remaining.filter(t => b.e.includes(t.group)).length;
  });
  const assigned = {};
  for (const slot of slots) {
    const cands = remaining.filter(t => slot.e.includes(t.group));
    const pick = cands.length > 0 ? cands[0] : remaining[0];
    if (pick) { assigned[slot.i] = pick.team; remaining.splice(remaining.indexOf(pick), 1); }
  }
  return assigned;
}

const PRIZE_KEYS = ['winner','runnerUp','third','pott','gott','worstGroup','worstL16','worstQF','worstOverall'];

// groupOverrides: { letter: [{teamName, pts, gd}] } — locked standings for complete groups
export function runSimulations(n = 10000, groupOverrides = {}) {
  const personTotal = {};
  const personBreakdown = {};
  const people = [...new Set(TEAMS.map(t => t.person).filter(Boolean))];
  people.forEach(p => {
    personTotal[p] = 0;
    personBreakdown[p] = Object.fromEntries(PRIZE_KEYS.map(k => [k, 0]));
  });

  for (let s = 0; s < n; s++) {
    const exit = {};
    const groupRank = {};
    const grpResult = {};
    const allThirds = [];

    for (const [letter, names] of Object.entries(GROUPS)) {
      let sorted;
      if (groupOverrides[letter]) {
        sorted = groupOverrides[letter]
          .map(({ teamName, pts, gd }) => ({ team: teamMap[teamName], pts, gd }))
          .filter(r => r.team);
      } else {
        sorted = simGroup(names);
      }
      grpResult[letter] = sorted;
      sorted.forEach(r => { groupRank[r.team.team] = { pts: r.pts, gd: r.gd }; });
      if (sorted[3]) exit[sorted[3].team.team] = 'group';
      if (sorted[2]) allThirds.push({ team: sorted[2].team, group: letter, pts: sorted[2].pts, gd: sorted[2].gd });
    }

    allThirds.sort((a,b) => b.pts-a.pts || b.gd-a.gd || a.team.p-b.team.p);
    const best8 = allThirds.slice(0, 8);
    allThirds.slice(8).forEach(t => { exit[t.team.team] = 'group'; });

    const thirdsMap = assignThirds(best8);
    const r32Pairs = R32.map((slots, i) => [
      slots[0].t === 'w' ? grpResult[slots[0].g][0].team
        : slots[0].t === 'r' ? grpResult[slots[0].g][1].team
        : thirdsMap[i] ?? null,
      slots[1].t === 'w' ? grpResult[slots[1].g][0].team
        : slots[1].t === 'r' ? grpResult[slots[1].g][1].team
        : thirdsMap[i] ?? null,
    ]);

    function simRound(pairs, round) {
      return pairs.map(([a, b]) => {
        if (!a) return b; if (!b) return a;
        const w = matchSim(a, b), l = w === a ? b : a;
        exit[l.team] = round; return w;
      });
    }

    const r32W = simRound(r32Pairs, 'r32');
    const r16W = simRound(R16.map(([a,b]) => [r32W[a], r32W[b]]), 'r16');
    const qfW  = simRound(QF.map(([a,b]) => [r16W[a], r16W[b]]), 'qf');
    const sfW = [], sfL = [];
    SF.forEach(([a,b]) => {
      const ta = qfW[a], tb = qfW[b];
      if (!ta||!tb) { sfW.push(ta??tb); return; }
      const w = matchSim(ta,tb), l = w===ta?tb:ta;
      exit[l.team]='sf'; sfW.push(w); sfL.push(l);
    });
    if (sfL.length===2) {
      const w=matchSim(sfL[0],sfL[1]), l=w===sfL[0]?sfL[1]:sfL[0];
      exit[w.team]='3rd'; exit[l.team]='4th';
    }
    if (sfW[0]&&sfW[1]) {
      const w=matchSim(sfW[0],sfW[1]), l=w===sfW[0]?sfW[1]:sfW[0];
      exit[w.team]='winner'; exit[l.team]='final';
    }

    const add = (team, key, amt) => {
      if (team?.person) { personTotal[team.person]+=amt; personBreakdown[team.person][key]+=amt; }
    };
    const byExit = r => TEAMS.filter(t => exit[t.team]===r);
    const worst = ts => ts.length ? ts.reduce((a,b) => a.odds>b.odds?a:b) : null;

    add(byExit('winner')[0], 'winner', 200);
    add(byExit('final')[0],  'runnerUp', 80);
    add(byExit('3rd')[0],    'third', 40);

    const last4 = [...byExit('sf'),...byExit('4th'),...byExit('final'),...byExit('winner'),...byExit('3rd')];
    if (last4.length) {
      const tot = last4.reduce((s,t) => s+t.p, 0);
      let r = Math.random()*tot;
      for (const t of last4) { r-=t.p; if (r<=0) { add(t,'pott',40); break; } }
    }

    add(TEAMS[Math.floor(Math.random()*TEAMS.length)], 'gott', 40);
    add(worst(byExit('group')), 'worstGroup', 20);
    add(worst(byExit('r32')),   'worstL16', 20);
    add(worst(byExit('r16')),   'worstQF', 20);

    const worstOverall = TEAMS.reduce((best,t) => {
      const s=groupRank[t.team]; if(!s) return best;
      const sb=groupRank[best?.team]; if(!sb) return t;
      if(s.pts!==sb.pts) return s.pts<sb.pts?t:best;
      if(s.gd!==sb.gd) return s.gd<sb.gd?t:best;
      return t.odds>best.odds?t:best;
    }, null);
    add(worstOverall, 'worstOverall', 20);
  }

  return {
    personEV: Object.fromEntries(Object.entries(personTotal).map(([p,v]) => [p, +(v/n).toFixed(2)])),
    personBreakdown: Object.fromEntries(Object.entries(personBreakdown).map(([p,d]) => [
      p, Object.fromEntries(Object.entries(d).map(([k,v]) => [k, +(v/n).toFixed(2)]))
    ])),
  };
}
