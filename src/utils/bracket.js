import T from "../tournament";

export const GROUP_COUNT = Object.keys(T.groups).length;

// Exit stages from earliest to latest. A team's exit is the knockout round it lost in;
// semi-final losers become "4th"/"3rd" when there's a third-place match.
export const EXIT_ORDER = ["group", ...T.rounds.slice(0, -1).map(r => r.slug), "4th", "3rd", "runnerUp", "winner"];

// "1E" → winner of E, "2C" → runner-up of C, "3ABCDF" → a best third from A/B/C/D/F
export const parseSlot = code => ({ pos: Number(code[0]), groups: code.slice(1) });

export function slotLabel(code) {
  const { pos, groups } = parseSlot(code);
  if (pos === 1) return `Winner Group ${groups}`;
  if (pos === 2) return `Runner-up Group ${groups}`;
  return `Best 3rd ${groups.split("").join("/")}`;
}

// Winners of one round paired into the next: [a, b, c, d] → [[a, b], [c, d]]
export const pairUp = arr => Array.from({ length: arr.length / 2 }, (_, k) => [arr[2 * k], arr[2 * k + 1]]);

// The bracket matches with a best-third slot: eligible groups and the (parsed) slot they face.
export const THIRD_SLOTS = T.bracket.flatMap((m, i) => {
  const third = [m.home, m.away].find(c => c[0] === "3");
  if (!third) return [];
  return [{ i, eligible: third.slice(1), opponent: parseSlot(third === m.home ? m.away : m.home) }];
});
// Allocation-table columns: the group winners facing a third, alphabetically (e.g. "BCEF")
const TABLE_COLUMNS = THIRD_SLOTS.map(s => s.opponent.groups).sort().join("");

// Assign qualifying third-placed teams to bracket matches → { matchIndex: team }.
// thirds: [{ group, team }] in ranking order. Uses the tournament's official allocation
// table when it has one and all qualifiers are known; otherwise matches each team to an
// eligible slot (Kuhn's augmenting paths, best-ranked first).
export function assignThirds(thirds) {
  const row = T.thirdPlaceTable && thirds.length === T.bestThirds
    && T.thirdPlaceTable[thirds.map(t => t.group).sort().join("")];
  if (row) {
    const byGroup = Object.fromEntries(thirds.map(t => [t.group, t.team]));
    return Object.fromEntries(THIRD_SLOTS.map(s =>
      [s.i, byGroup[row[TABLE_COLUMNS.indexOf(s.opponent.groups)]]]));
  }

  const slotToTeam = new Array(THIRD_SLOTS.length).fill(-1);
  const teamToSlot = new Array(thirds.length).fill(-1);
  function augment(si, visited) {
    for (let ti = 0; ti < thirds.length; ti++) {
      if (visited[ti] || !THIRD_SLOTS[si].eligible.includes(thirds[ti].group)) continue;
      visited[ti] = true;
      if (teamToSlot[ti] === -1 || augment(teamToSlot[ti], visited)) {
        slotToTeam[si] = ti;
        teamToSlot[ti] = si;
        return true;
      }
    }
    return false;
  }
  THIRD_SLOTS.forEach((_, si) => augment(si, new Array(thirds.length).fill(false)));
  return Object.fromEntries(THIRD_SLOTS.flatMap((s, si) => slotToTeam[si] >= 0 ? [[s.i, thirds[slotToTeam[si]].team]] : []));
}
