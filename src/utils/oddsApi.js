import { draw } from '../data/draw';
import { getCached, setCache } from './cache';

const CACHE_KEY = 'odds_api_current';
const TTL_ODDS = 15 * 60 * 1000;
// Verify this key at https://api.the-odds-api.com/v4/sports/ — may vary by season
const SPORT_KEY = 'soccer_world_cup_winner';

const ODDS_API_ALIASES = {
  'united states': 'usa',
  'united states of america': 'usa',
  'czechia': 'czech republic',
  "cote d'ivoire": 'ivory coast',
  "côte d'ivoire": 'ivory coast',
  'bosnia & herzegovina': 'bosnia and herzegovina',
  'bosnia-herzegovina': 'bosnia and herzegovina',
  'republic of korea': 'south korea',
  'türkiye': 'turkey',
  'democratic republic of congo': 'dr congo',
  'dr. congo': 'dr congo',
  'cape verde islands': 'cape verde',
  'curaçao': 'curacao',
};

const drawByLower = Object.fromEntries(draw.map(e => [e.team.toLowerCase(), e.team]));

function resolveTeamName(apiName) {
  const lower = apiName.toLowerCase().trim();
  const mapped = ODDS_API_ALIASES[lower] ?? lower;
  if (drawByLower[mapped]) return drawByLower[mapped];
  for (const [k, v] of Object.entries(drawByLower)) {
    if (mapped.includes(k) || k.includes(mapped)) return v;
  }
  return null;
}

// Returns { teamName: avgDecimalOdds } from UK bookmakers, averaged across bookmakers.
// Returns null if API key not set, fetch fails, or no data found.
export async function fetchCurrentOdds() {
  const cached = getCached(CACHE_KEY, TTL_ODDS);
  if (cached) return cached;

  const apiKey = import.meta.env.VITE_ODDS_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/?apiKey=${apiKey}&regions=uk&markets=outrights&oddsFormat=decimal`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const teamAccum = {};
    for (const event of (Array.isArray(data) ? data : [])) {
      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          if (market.key !== 'outrights') continue;
          for (const outcome of market.outcomes ?? []) {
            const resolved = resolveTeamName(outcome.name);
            if (!resolved) continue;
            if (!teamAccum[resolved]) teamAccum[resolved] = { sum: 0, count: 0 };
            teamAccum[resolved].sum += outcome.price;
            teamAccum[resolved].count++;
          }
        }
      }
    }

    if (Object.keys(teamAccum).length === 0) return null;
    const result = Object.fromEntries(
      Object.entries(teamAccum).map(([team, { sum, count }]) => [team, +(sum / count).toFixed(2)])
    );
    setCache(CACHE_KEY, result);
    return result;
  } catch {
    return null;
  }
}

// Returns milliseconds since the odds cache was last written, or null if no cache.
export function getCachedOddsAge() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts } = JSON.parse(raw);
    return Date.now() - ts;
  } catch {
    return null;
  }
}
