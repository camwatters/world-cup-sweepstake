// 2026 FIFA World Cup — 48 teams, 12 groups of 4, top two + 8 best thirds → Round of 32.

// Sweepstake draw: pre-tournament decimal odds and who drew each team.
const draw = [
  { team: "Spain",                 odds: 5.5,  person: "Simon",   flag: "es"     },
  { team: "France",                 odds: 6,    person: "James B", flag: "fr"     },
  { team: "England",                odds: 7.5,  person: "James T", flag: "gb-eng" },
  { team: "Portugal",               odds: 9,    person: "Ben",     flag: "pt"     },
  { team: "Brazil",                 odds: 9,    person: "Meg",     flag: "br"     },
  { team: "Argentina",              odds: 10,   person: "Gergna",  flag: "ar"     },
  { team: "Germany",                odds: 15,   person: "James R", flag: "de"     },
  { team: "Netherlands",            odds: 21,   person: "AJ",      flag: "nl"     },
  { team: "Norway",                 odds: 26,   person: "Greg",    flag: "no"     },
  { team: "Belgium",                odds: 34,   person: "Mikey",   flag: "be"     },
  { team: "Colombia",               odds: 34,   person: "James R", flag: "co"     },
  { team: "Japan",                  odds: 51,   person: "Charlie", flag: "jp"     },
  { team: "Morocco",                odds: 51,   person: "Will",    flag: "ma"     },
  { team: "Mexico",                 odds: 67,   person: "Jim",     flag: "mx"     },
  { team: "USA",                    odds: 67,   person: "Hayden",  flag: "us"     },
  { team: "Uruguay",                odds: 67,   person: "Blade",   flag: "uy"     },
  { team: "Switzerland",            odds: 81,   person: "Dom",     flag: "ch"     },
  { team: "Turkey",                 odds: 81,   person: "Simon",   flag: "tr"     },
  { team: "Croatia",                odds: 81,   person: "Cam",     flag: "hr"     },
  { team: "Ecuador",                odds: 101,  person: "Josh O",  flag: "ec"     },
  { team: "Senegal",                odds: 126,  person: "Hayden",  flag: "sn"     },
  { team: "Sweden",                 odds: 126,  person: "Gergna",  flag: "se"     },
  { team: "Canada",                 odds: 126,  person: "Jack P",  flag: "ca"     },
  { team: "Austria",                odds: 151,  person: "Blade",   flag: "at"     },
  { team: "Paraguay",               odds: 151,  person: "George",  flag: "py"     },
  { team: "Scotland",               odds: 251,  person: "Yani",    flag: "gb-sct" },
  { team: "Ivory Coast",            odds: 301,  person: "George",  flag: "ci"     },
  { team: "Czech Republic",         odds: 301,  person: "Eve",     flag: "cz"     },
  { team: "Egypt",                  odds: 301,  person: "Josie",   flag: "eg"     },
  { team: "Bosnia and Herzegovina", odds: 351,  person: "Tom Gee", flag: "ba"     },
  { team: "South Korea",            odds: 401,  person: "Dave",    flag: "kr"     },
  { team: "Algeria",                odds: 401,  person: "Charlie", flag: "dz"     },
  { team: "Ghana",                  odds: 401,  person: "Yani",    flag: "gh"     },
  { team: "Australia",              odds: 501,  person: "Greg",    flag: "au"     },
  { team: "Iran",                   odds: 501,  person: "Matt W",  flag: "ir"     },
  { team: "Tunisia",                odds: 501,  person: "Mikey",   flag: "tn"     },
  { team: "DR Congo",               odds: 751,  person: "Dan",     flag: "cd"     },
  { team: "Saudi Arabia",           odds: 1001, person: "Jack C",  flag: "sa"     },
  { team: "South Africa",           odds: 1001, person: "Jim",     flag: "za"     },
  { team: "Panama",                 odds: 1501, person: "Dan",     flag: "pa"     },
  { team: "Iraq",                   odds: 1501, person: "Matt W",  flag: "iq"     },
  { team: "Uzbekistan",             odds: 1501, person: "Cam",     flag: "uz"     },
  { team: "Qatar",                  odds: 2001, person: "Blade",   flag: "qa"     },
  { team: "Cape Verde",             odds: 2001, person: "Tim",     flag: "cv"     },
  { team: "New Zealand",            odds: 2501, person: "AJ",      flag: "nz"     },
  { team: "Jordan",                 odds: 2501, person: "Josh",    flag: "jo"     },
  { team: "Haiti",                  odds: 2501, person: "Lucy",    flag: "ht"     },
  { team: "Curacao",                odds: 3501, person: "Josh",    flag: "cw"     },
];

export default {
  brand: "WC2026 Sweepstake",
  title: "2026 FIFA World Cup",
  espn: { league: "fifa.world", season: 2026 },
  oddsSportKey: "soccer_world_cup_winner", // verify at https://api.the-odds-api.com/v4/sports/
  start: "2026-06-11",
  end: "2026-07-19",
  draw,

  groups: {
    A: ["Mexico", "Czech Republic", "South Korea", "South Africa"],
    B: ["Canada", "Bosnia and Herzegovina", "Switzerland", "Qatar"],
    C: ["Brazil", "Scotland", "Haiti", "Morocco"],
    D: ["Paraguay", "Turkey", "Australia", "USA"],
    E: ["Ecuador", "Germany", "Ivory Coast", "Curacao"],
    F: ["Netherlands", "Sweden", "Japan", "Tunisia"],
    G: ["Belgium", "Iran", "Egypt", "New Zealand"],
    H: ["Spain", "Uruguay", "Saudi Arabia", "Cape Verde"],
    I: ["Norway", "France", "Senegal", "Iraq"],
    J: ["Argentina", "Austria", "Algeria", "Jordan"],
    K: ["Colombia", "Portugal", "Uzbekistan", "DR Congo"],
    L: ["England", "Croatia", "Panama", "Ghana"],
  },
  bestThirds: 8,
  // FIFA's 495-row allocation table isn't encoded; third-placed teams are matched to an
  // eligible slot until ESPN publishes the real fixtures.
  thirdPlaceTable: null,

  // Knockout rounds in order (ESPN round slugs). The first is played by `bracket`.
  rounds: [
    { slug: "round-of-32",   label: "Round of 32",    when: "28 Jun – 3 Jul" },
    { slug: "round-of-16",   label: "Round of 16",    when: "4–7 Jul" },
    { slug: "quarterfinals", label: "Quarter-finals", when: "9–11 Jul" },
    { slug: "semifinals",    label: "Semi-finals",    when: "14–15 Jul" },
    { slug: "final",         label: "Final",          when: "19 Jul · MetLife Stadium" },
  ],
  thirdPlaceMatch: true,

  // First knockout round in bracket order: matches 2k and 2k+1 meet in match k of the
  // next round, all the way to the final. Slots: "1E" winner of E, "2C" runner-up of C,
  // "3ABCDF" a best third-placed team from one of those groups.
  bracket: [
    { home: "1E", away: "3ABCDF", date: "29 Jun", venue: "Foxborough" },
    { home: "1I", away: "3CDFGH", date: "30 Jun", venue: "East Rutherford" },
    { home: "2A", away: "2B",     date: "28 Jun", venue: "Inglewood" },
    { home: "1F", away: "2C",     date: "29 Jun", venue: "Guadalupe" },
    { home: "2K", away: "2L",     date: "2 Jul",  venue: "Toronto" },
    { home: "1H", away: "2J",     date: "2 Jul",  venue: "Inglewood" },
    { home: "1D", away: "3BEFIJ", date: "1 Jul",  venue: "Santa Clara" },
    { home: "1G", away: "3AEHIJ", date: "1 Jul",  venue: "Seattle" },
    { home: "1C", away: "2F",     date: "29 Jun", venue: "Houston" },
    { home: "2E", away: "2I",     date: "30 Jun", venue: "Arlington" },
    { home: "1A", away: "3CEFHI", date: "30 Jun", venue: "Mexico City" },
    { home: "1L", away: "3EHIJK", date: "1 Jul",  venue: "Atlanta" },
    { home: "1J", away: "2H",     date: "3 Jul",  venue: "Miami Gardens" },
    { home: "2D", away: "2G",     date: "3 Jul",  venue: "Arlington" },
    { home: "1B", away: "3EFGIJ", date: "2 Jul",  venue: "Vancouver" },
    { home: "1K", away: "3DEIJL", date: "3 Jul",  venue: "Kansas City" },
  ],

  // type: winner | runnerUp | third | pott | gott | worstOverall | worstReached (needs `round`:
  // the worst team by pre-tournament odds to play in that knockout round).
  prizes: [
    { key: "winner",       type: "winner",       amount: 200, top: true, name: "Winner",                             short: "Tournament winner" },
    { key: "runnerUp",     type: "runnerUp",     amount: 80,  top: true, name: "Runner-up",                          short: "Runner-up" },
    { key: "third",        type: "third",        amount: 40,  top: true, name: "Third Place",                        short: "Third place" },
    { key: "pott",         type: "pott",         amount: 40,             name: "Player of the Tournament",           short: "Player of Tournament" },
    { key: "gott",         type: "gott",         amount: 40,             name: "Goal of the Tournament",             short: "Goal of Tournament" },
    { key: "worstOverall", type: "worstOverall", amount: 20,             name: "Worst Team Overall",                 short: "Worst team overall" },
    { key: "worstGroup",   type: "worstReached", amount: 20, round: "round-of-32",   name: "Worst Team to exit Group Stage",     short: "Worst to exit groups" },
    { key: "worstL16",     type: "worstReached", amount: 20, round: "round-of-16",   name: "Worst Team to reach Last 16",        short: "Worst to reach L16" },
    { key: "worstQF",      type: "worstReached", amount: 20, round: "quarterfinals", name: "Worst Team to reach Quarter-Finals", short: "Worst to reach QFs" },
  ],

  // Current Goal of the Tournament holder (manually updated). quality/perGameProb calibrate
  // how likely a later goal is to beat it.
  gott: { team: "Cape Verde", quality: 0.9, perGameProb: 0.03 },
};
