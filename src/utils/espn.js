import T from "../tournament";
import { getCached, setCache, TTL } from "./cache";

const { league, season } = T.espn;
const ESPN_STANDINGS = `https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${season}`;
const ESPN_SCOREBOARD = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`;

// External name variants (ESPN + The Odds API) → lowercase draw team name
const ALIASES = {
  "czechia": "czech republic",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "bosnia & herzegovina": "bosnia and herzegovina",
  "türkiye": "turkey",
  "united states": "usa",
  "united states of america": "usa",
  "curaçao": "curacao",
  "congo dr": "dr congo",
  "democratic republic of congo": "dr congo",
  "dr. congo": "dr congo",
  "korea republic": "south korea",
  "republic of korea": "south korea",
  "cabo verde": "cape verde",
  "cape verde islands": "cape verde",
  "cote d'ivoire": "ivory coast",
  "côte d'ivoire": "ivory coast",
};

const drawByLower = Object.fromEntries(T.draw.map(e => [e.team.toLowerCase(), e]));

// Resolve an external team name to its draw entry (T.draw), or null.
export function findEntry(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  const key = ALIASES[lower] ?? lower;
  if (drawByLower[key]) return drawByLower[key];
  for (const [k, v] of Object.entries(drawByLower)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

// Lowercase draw name for an external team name (the name itself if it isn't in the draw)
export const teamKey = name => name ? (findEntry(name)?.team ?? name).toLowerCase() : null;
// Order-independent "a|b" key for a match, from two keys / two team names
export const joinKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
export const pairKey = (a, b) => joinKey(teamKey(a), teamKey(b));

export function getStats(entry) {
  return Object.fromEntries((entry.stats ?? []).map(s => [s.name, s.value]));
}

export function standingsGroups(standings) {
  return standings?.children ?? standings?.standings?.groups ?? [];
}

export const groupLetter = group => (group.name ?? "").replace("Group ", "").trim();

// Standings entries in table order: ESPN's rank (full tiebreakers incl. head-to-head),
// falling back to pts → GD → GF when rank is unavailable.
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const sa = getStats(a), sb = getStats(b);
    if (sa.rank != null && sb.rank != null && sa.rank !== sb.rank) return sa.rank - sb.rank;
    return (sb.points ?? 0) - (sa.points ?? 0)
      || (sb.pointDifferential ?? 0) - (sa.pointDifferential ?? 0)
      || (sb.pointsFor ?? sb.goalsScored ?? 0) - (sa.pointsFor ?? sa.goalsScored ?? 0);
  });
}

export function homeAway(event) {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  return [competitors.find(c => c.homeAway === "home"), competitors.find(c => c.homeAway === "away")];
}

// ESPN's round slug, e.g. "group-stage", "round-of-32", "quarterfinals", "3rd-place-match", "final"
export const roundOf = event => event.season?.slug ?? "";
export const isKnockout = event => roundOf(event) !== "" && roundOf(event) !== "group-stage";
export const isFirstRound = event => roundOf(event) === T.rounds[0].slug;

// Once the tournament is well over its data can't change, so it's cached under a key
// that never expires instead of being refetched every few minutes.
const FINAL = Date.now() > Date.parse(T.end) + 2 * 864e5;
const cacheFor = (name, ttl) => FINAL ? [`${name}_final`, Infinity] : [name, ttl];

export async function fetchStandings() {
  const [cacheKey, ttl] = cacheFor(`espn_standings_${league}_${season}`, TTL.STANDINGS);
  const cached = getCached(cacheKey, ttl);
  if (cached) return cached;
  const res = await fetch(ESPN_STANDINGS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const standings = await res.json();
  setCache(cacheKey, standings);
  return standings;
}

// ESPN's scoreboard rejects date ranges, so fetch every tournament day in parallel and
// cache the combined list.
export async function fetchTournamentEvents() {
  const [cacheKey, ttl] = cacheFor(`espn_events_${league}_${season}`, TTL.SCORES);
  const cached = getCached(cacheKey, ttl);
  if (cached) return cached;
  const days = [];
  for (let d = Date.parse(T.start); d <= Date.parse(T.end); d += 864e5) {
    days.push(new Date(d).toISOString().slice(0, 10).replace(/-/g, ""));
  }
  const responses = await Promise.all(days.map(async day => {
    const res = await fetch(`${ESPN_SCOREBOARD}?dates=${day}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }));
  const byId = new Map(responses.flatMap(r => r.events ?? []).map(e => [e.id, e]));
  const events = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  setCache(cacheKey, events);
  return events;
}
