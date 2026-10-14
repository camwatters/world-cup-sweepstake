import { getCached, setCache } from './cache';
import { findEntry } from './espn';
import T from '../tournament';

const SPORT_KEY = T.oddsSportKey;
const CACHE_KEY = `odds_api_${SPORT_KEY}`;
const TTL_ODDS = 15 * 60 * 1000;

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
            const resolved = findEntry(outcome.name)?.team;
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
