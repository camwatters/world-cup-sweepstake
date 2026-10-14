import { draw } from "../data/draw";
import { getCached, setCache, TTL } from "./cache";

export const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// External name variants (ESPN + The Odds API) → lowercase draw.js name
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

const drawByLower = Object.fromEntries(draw.map(e => [e.team.toLowerCase(), e]));

// Resolve an external team name to its draw.js entry, or null.
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

export function getStats(entry) {
  return Object.fromEntries((entry.stats ?? []).map(s => [s.name, s.value]));
}

export function standingsGroups(standings) {
  return standings?.children ?? standings?.standings?.groups ?? [];
}

export function homeAway(event) {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  return [competitors.find(c => c.homeAway === "home"), competitors.find(c => c.homeAway === "away")];
}

// ESPN's round slug, e.g. "group-stage", "round-of-32", "quarterfinals", "3rd-place-match", "final"
export const roundOf = event => event.season?.slug ?? "";
export const isKnockout = event => roundOf(event) !== "" && roundOf(event) !== "group-stage";

// ESPN's scoreboard rejects date ranges, so fetch every tournament day (11 Jun – 19 Jul)
// in parallel and cache the combined list.
export async function fetchTournamentEvents() {
  const cacheKey = "espn_events_v1";
  const cached = getCached(cacheKey, TTL.SCORES);
  if (cached) return cached;
  const days = [];
  for (let d = Date.UTC(2026, 5, 11); d <= Date.UTC(2026, 6, 19); d += 864e5) {
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
