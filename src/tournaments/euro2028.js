// UEFA Euro 2028 — 24 teams, 6 groups of 4, top two + 4 best thirds → Round of 16.
// Hosts: England, Republic of Ireland, Scotland, Wales. 9 June – 9 July 2028.
//
// TODO once the final draw is made (late 2027):
//   - fill in `groups` with ESPN-style team names and `draw` (odds, owners, flag codes)
//   - decide `prizes`: there is no third-place match, and "exit group stage" now means
//     the same as "reach Last 16"
//   - set the starting `gott` holder (or null) and check `oddsSportKey`

// Sweepstake draw: { team, odds, person, flag } — flag is a public/flags/<code>.svg name.
const draw = [];

export default {
  brand: "Euro 2028 Sweepstake",
  title: "UEFA Euro 2028",
  espn: { league: "uefa.euro", season: 2028 },
  oddsSportKey: "soccer_uefa_european_championship_winner", // verify at https://api.the-odds-api.com/v4/sports/
  start: "2028-06-09",
  end: "2028-07-09",
  draw,

  groups: {
    A: [], B: [], C: [], D: [], E: [], F: [],
  },
  bestThirds: 4,
  // UEFA's allocation: which group's third plays each group winner, keyed by the four
  // groups whose thirds qualify. Value letters are the opponents of [1B, 1C, 1E, 1F].
  thirdPlaceTable: {
    ABCD: "ADBC", ABCE: "AEBC", ABCF: "AFBC", ABDE: "DEAB", ABDF: "DFAB",
    ABEF: "EFBA", ACDE: "EDCA", ACDF: "FDCA", ACEF: "EFCA", ADEF: "EFDA",
    BCDE: "EDBC", BCDF: "FDCB", BCEF: "FECB", BDEF: "FEDB", CDEF: "FEDC",
  },
  thirdPlaceTableWinners: "BCEF",

  rounds: [
    { slug: "round-of-16",   label: "Round of 16",    when: "24–27 Jun" },
    { slug: "quarterfinals", label: "Quarter-finals", when: "30 Jun – 1 Jul" },
    { slug: "semifinals",    label: "Semi-finals",    when: "4–5 Jul" },
    { slug: "final",         label: "Final",          when: "9 Jul · Wembley" },
  ],
  thirdPlaceMatch: false,

  // Round of 16 in bracket order (matches 39, 37, 41, 42, 44, 43, 40, 38).
  bracket: [
    { home: "1B", away: "3ADEF", date: "25 Jun", venue: "Newcastle" },
    { home: "1A", away: "2C",    date: "24 Jun", venue: "Cardiff" },
    { home: "1F", away: "3ABC",  date: "26 Jun", venue: "Glasgow" },
    { home: "2D", away: "2E",    date: "26 Jun", venue: "London (Tottenham)" },
    { home: "1E", away: "3ABCD", date: "27 Jun", venue: "Dublin" },
    { home: "1D", away: "2F",    date: "27 Jun", venue: "Birmingham" },
    { home: "1C", away: "3DEF",  date: "25 Jun", venue: "Manchester" },
    { home: "2A", away: "2B",    date: "24 Jun", venue: "Liverpool" },
  ],

  // Placeholder: same as the 2026 World Cup until the prizes are decided (see TODO above).
  prizes: [
    { key: "winner",       type: "winner",       amount: 200, top: true, name: "Winner",                             short: "Tournament winner" },
    { key: "runnerUp",     type: "runnerUp",     amount: 80,  top: true, name: "Runner-up",                          short: "Runner-up" },
    { key: "third",        type: "third",        amount: 40,  top: true, name: "Third Place",                        short: "Third place" },
    { key: "pott",         type: "pott",         amount: 40,             name: "Player of the Tournament",           short: "Player of Tournament" },
    { key: "gott",         type: "gott",         amount: 40,             name: "Goal of the Tournament",             short: "Goal of Tournament" },
    { key: "worstOverall", type: "worstOverall", amount: 20,             name: "Worst Team Overall",                 short: "Worst team overall" },
    { key: "worstGroup",   type: "worstReached", amount: 20, round: "round-of-16",   name: "Worst Team to exit Group Stage",     short: "Worst to exit groups" },
    { key: "worstL16",     type: "worstReached", amount: 20, round: "round-of-16",   name: "Worst Team to reach Last 16",        short: "Worst to reach L16" },
    { key: "worstQF",      type: "worstReached", amount: 20, round: "quarterfinals", name: "Worst Team to reach Quarter-Finals", short: "Worst to reach QFs" },
  ],

  gott: null,
};
