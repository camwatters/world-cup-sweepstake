// Circular wheel bracket.
// Architecture: single responsive SVG (viewBox) with <foreignObject> for flag images.
// foreignObject scales with the SVG viewBox so flags are correct on all screen sizes.
// touch-action on the wrapper enables native mobile pinch-to-zoom/pan.
//
// Bracket connectivity — sequential slot order maps exactly:
//   R16 circular pair k  →  r16W[ CIR_R16[k] ]
//   QF  circular pair k  →  qfW[k]
//   SF  circular pair k  →  sfW[k]

import { draw } from '../data/draw';

const CIR_R16 = [0, 1, 4, 5, 2, 3, 6, 7];

// resolveSlot returns { label, team } with no entry/flag — look it up from draw data.
const ALIASES = {
  czechia: 'czech republic', 'bosnia-herzegovina': 'bosnia and herzegovina',
  'türkiye': 'turkey', 'united states': 'usa', 'curaçao': 'curacao',
  'congo dr': 'dr congo', 'korea republic': 'south korea', 'cabo verde': 'cape verde',
};
const TEAM_MAP = {};
draw.forEach(e => { TEAM_MAP[e.team.toLowerCase()] = e; });

function flagCode(teamName) {
  if (!teamName) return null;
  const lower = teamName.toLowerCase();
  const key   = ALIASES[lower] ?? lower;
  if (TEAM_MAP[key]) return TEAM_MAP[key].flag;
  for (const [k, v] of Object.entries(TEAM_MAP)) {
    if (key.includes(k) || k.includes(key)) return v.flag;
  }
  return null;
}

const GOLD = '#f59e0b';
const DIM  = '#1e3a5f';
const DEAD = 'rgba(255,255,255,0.04)'; // near-invisible for eliminated paths

function xy(cx, cy, deg, r) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

function same(a, b) {
  return !!(a && b && a.toLowerCase() === b.toLowerCase());
}

// Angle of a bracket sub-tree midpoint at given level and index.
function junDeg(level, k) {
  const tpj = Math.pow(2, level + 1);
  return (k * tpj + (tpj - 1) / 2) * (360 / 32);
}

// Gold if the team at this node is still in the tournament (won or yet to play next).
// Dead if they were eliminated. Dim if we don't know the team yet.
function edgeState(teamAtNode, nextRoundWinner) {
  if (!teamAtNode) return 'none';
  if (!nextRoundWinner) return 'won';   // advancing — extend gold forward
  return same(teamAtNode, nextRoundWinner) ? 'won' : 'lost';
}
function lineColor(s) {
  return s === 'won' ? GOLD : s === 'lost' ? DEAD : DIM;
}
const LW = { won: 2.5, lost: 1, none: 1.5 };

// ─── main component ───────────────────────────────────────────────────────────

export default function CircularBracket({ resolvedR32, slotW, r16W, qfW, sfW, pairWinner }) {
  const SIZE     = 700;
  const CX       = SIZE / 2;
  const CY       = SIZE / 2;
  const BASE     = import.meta.env.BASE_URL;

  const FLAG_R   = 312;   // centre of flag circles from origin
  const FR       = 20;    // flag circle radius (slightly smaller outer rings)
  const JR       = [252, 200, 150, 103]; // R32, R16, QF, SF junction radii
  const JFR      = [10, 13, 16, 20];     // flag radius at each junction level
  const WIN_RAD  = 42;    // winner circle radius

  const finalW = sfW ? pairWinner(sfW[0], sfW[1]) : null;

  // ── helpers ──────────────────────────────────────────────────────────────
  function flagPos(slot) { return xy(CX, CY, slot * 11.25, FLAG_R); }
  function flagInner(slot) { return xy(CX, CY, slot * 11.25, FLAG_R - FR - 3); }
  function jPos(level, k) { return xy(CX, CY, junDeg(level, k), JR[level]); }

  // ── per-slot data ─────────────────────────────────────────────────────────
  const slots = Array.from({ length: 32 }, (_, i) => {
    const mi   = Math.floor(i / 2);
    const side = i % 2 === 0 ? resolvedR32[mi].home : resolvedR32[mi].away;
    const name = side.team || null;
    const code = flagCode(name);        // resolveSlot has no entry; look up from draw
    const w    = slotW[mi];
    const won  = !!(w && name && same(name, w));
    const lost = !!(w && name && !same(name, w));
    return { i, mi, name, code, won, lost };
  });

  // ── bracket lines ─────────────────────────────────────────────────────────

  // flag → R32 junction
  const flagLines = slots.map(({ i, mi, name, won, lost }) => {
    const [x1, y1] = flagInner(i);
    const [x2, y2] = jPos(0, mi);
    const s = lost ? 'lost' : name ? 'won' : 'none';
    return <line key={`fl-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
  });

  // R32 junction → R16 junction
  const r32Lines = Array.from({ length: 16 }, (_, k) => {
    const [x1, y1] = jPos(0, k);
    const r16K = Math.floor(k / 2);
    const [x2, y2] = jPos(1, r16K);
    const s = edgeState(slotW[k], r16W?.[CIR_R16[r16K]]);
    return <line key={`r32l-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
  });

  // R16 junction → QF junction
  const r16Lines = Array.from({ length: 8 }, (_, k) => {
    const [x1, y1] = jPos(1, k);
    const qfK = Math.floor(k / 2);
    const [x2, y2] = jPos(2, qfK);
    const s = edgeState(r16W?.[CIR_R16[k]], qfW?.[qfK]);
    return <line key={`r16l-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
  });

  // QF junction → SF junction
  const qfLines = Array.from({ length: 4 }, (_, k) => {
    const [x1, y1] = jPos(2, k);
    const sfK = Math.floor(k / 2);
    const [x2, y2] = jPos(3, sfK);
    const s = edgeState(qfW?.[k], sfW?.[sfK]);
    return <line key={`qfl-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
  });

  // SF junction → centre
  const sfLines = Array.from({ length: 2 }, (_, k) => {
    const [x1, y1] = jPos(3, k);
    const s = edgeState(sfW?.[k], finalW);
    return <line key={`sfl-${k}`} x1={x1} y1={y1} x2={CX} y2={CY}
      stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
  });

  // ── junction dots — show winner's flag as trail marker ───────────────────
  // When a winner is known, renders a small flag circle instead of a plain dot.
  function JunctionFlag({ pos, winner, r }) {
    const [cx, cy] = pos;
    const code = flagCode(winner);
    const url  = code ? `${BASE}flags/${code}.svg` : null;
    if (winner && url) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={r + 7} fill={GOLD} opacity="0.15" />
          <circle cx={cx} cy={cy} r={r + 3} fill={GOLD} opacity="0.28" />
          <circle cx={cx} cy={cy} r={r + 1.5} fill={GOLD} />
          <foreignObject x={cx - r} y={cy - r} width={r * 2} height={r * 2}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#1e293b' }}>
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </foreignObject>
        </g>
      );
    }
    return <circle cx={cx} cy={cy} r={r * 0.45} fill={DIM} />;
  }

  const r32Dots = Array.from({ length: 16 }, (_, k) => (
    <JunctionFlag key={`r32d-${k}`} pos={jPos(0, k)} winner={slotW[k]}      r={JFR[0]} />
  ));
  const r16Dots = Array.from({ length: 8 }, (_, k) => (
    <JunctionFlag key={`r16d-${k}`} pos={jPos(1, k)} winner={r16W?.[CIR_R16[k]]} r={JFR[1]} />
  ));
  const qfDots = Array.from({ length: 4 }, (_, k) => (
    <JunctionFlag key={`qfd-${k}`} pos={jPos(2, k)} winner={qfW?.[k]}       r={JFR[2]} />
  ));
  const sfDots = Array.from({ length: 2 }, (_, k) => (
    <JunctionFlag key={`sfd-${k}`} pos={jPos(3, k)} winner={sfW?.[k]}       r={JFR[3]} />
  ));

  // ── flag circles (foreignObject so they scale with the SVG viewBox) ─────────
  const winCode = flagCode(finalW);

  const flagCircles = slots.map(({ i, code, won, lost }) => {
    const [fx, fy] = flagPos(i);
    const url = code ? `${BASE}flags/${code}.svg` : null;
    const ringColor = won ? GOLD : lost ? '#1f2937' : '#334155';
    const ringW = won ? 3 : 2;
    return (
      <g key={`flag-${i}`} opacity={lost ? 0.18 : 1}>
        {won && <circle cx={fx} cy={fy} r={FR + 14} fill={GOLD} opacity="0.12" />}
        {won && <circle cx={fx} cy={fy} r={FR + 7}  fill={GOLD} opacity="0.22" />}
        {/* border ring */}
        <circle cx={fx} cy={fy} r={FR + ringW} fill={ringColor} />
        {/* flag image via foreignObject — scales with viewBox */}
        <foreignObject x={fx - FR} y={fy - FR} width={FR * 2} height={FR * 2}>
          <div style={{
            width: '100%', height: '100%',
            borderRadius: '50%', overflow: 'hidden',
            background: '#1e293b',
          }}>
            {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </div>
        </foreignObject>
      </g>
    );
  });

  // ── centre winner ─────────────────────────────────────────────────────────
  const winUrl = winCode ? `${BASE}flags/${winCode}.svg` : null;
  const centre = (
    <g>
      {finalW && <>
        <circle cx={CX} cy={CY} r={WIN_RAD + 22} fill={GOLD} opacity="0.09" />
        <circle cx={CX} cy={CY} r={WIN_RAD + 12} fill={GOLD} opacity="0.17" />
        <circle cx={CX} cy={CY} r={WIN_RAD + 4}  fill={GOLD} />
      </>}
      {!finalW && <circle cx={CX} cy={CY} r={WIN_RAD + 4} fill="#1e3a5f" />}
      <foreignObject x={CX - WIN_RAD} y={CY - WIN_RAD} width={WIN_RAD * 2} height={WIN_RAD * 2}>
        <div style={{
          width: '100%', height: '100%',
          borderRadius: '50%', overflow: 'hidden',
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {winUrl
            ? <img src={winUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: WIN_RAD * 0.9 }}>🏆</span>
          }
        </div>
      </foreignObject>
    </g>
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ color: '#64748b', fontSize: 11, letterSpacing: 3, fontWeight: 600, fontFamily: 'system-ui,sans-serif', textTransform: 'uppercase' }}>
          2026 FIFA World Cup
        </div>
        <div style={{ color: '#334155', fontSize: 10, letterSpacing: 2, fontFamily: 'system-ui,sans-serif', textTransform: 'uppercase' }}>
          Knockouts
        </div>
      </div>

      {/* Responsive wheel — scales to screen width; pinch-to-zoom/pan enabled */}
      <div style={{
        width: '100%',
        maxWidth: SIZE,
        margin: '0 auto',
        touchAction: 'pan-x pan-y pinch-zoom',
      }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 16 }}
        >
          <defs>
            <radialGradient id="cb-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#172035" />
              <stop offset="70%"  stopColor="#0d1525" />
              <stop offset="100%" stopColor="#070c18" />
            </radialGradient>
          </defs>

          <rect width={SIZE} height={SIZE} fill="url(#cb-bg)" rx="16" />

          {/* Subtle guide rings */}
          {[FLAG_R, ...JR].map(r => (
            <circle key={r} cx={CX} cy={CY} r={r}
              fill="none" stroke="#fff" strokeWidth="0.4" opacity="0.05" />
          ))}

          {/* Lines — back to front */}
          {sfLines}
          {qfLines}
          {r16Lines}
          {r32Lines}
          {flagLines}

          {/* Junction dots */}
          {r32Dots}
          {r16Dots}
          {qfDots}
          {sfDots}

          {/* Flag circles (foreignObject scales with SVG) */}
          {flagCircles}

          {/* Winner centre */}
          {centre}
        </svg>
      </div>
    </div>
  );
}
