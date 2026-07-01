// Circular wheel bracket.
// Architecture: SVG layer for background/lines/dots, HTML <img> layer for flag circles.
// SVG <image> cannot load local SVG files, so flag circles are absolutely-positioned
// HTML elements overlaid on the SVG.
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

const GOLD   = '#f59e0b';
const BLUE   = '#60a5fa';
const DIM    = '#1e3a5f';
const DEAD   = '#0a0f1a';

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

function edgeState(teamAtNode, nextRoundWinner) {
  if (!teamAtNode) return 'none';
  if (!nextRoundWinner) return 'active';
  return same(teamAtNode, nextRoundWinner) ? 'won' : 'lost';
}
function lineColor(s) {
  return s === 'won' ? GOLD : s === 'active' ? BLUE : s === 'lost' ? DEAD : DIM;
}
const LW = { won: 2.5, active: 2, lost: 1.5, none: 1.5 };

// ─── main component ───────────────────────────────────────────────────────────

export default function CircularBracket({ resolvedR32, slotW, r16W, qfW, sfW, pairWinner }) {
  const SIZE     = 700;
  const CX       = SIZE / 2;
  const CY       = SIZE / 2;
  const BASE     = import.meta.env.BASE_URL;

  const FLAG_R   = 312;   // centre of flag circles from origin
  const FR       = 26;    // flag circle radius  (52px diameter)
  const JR       = [252, 200, 150, 103]; // R32, R16, QF, SF junction radii
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
    const s = won ? 'won' : lost ? 'lost' : name ? 'active' : 'none';
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

  // ── junction dots ─────────────────────────────────────────────────────────
  function Dot({ pos, won, r }) {
    const [cx, cy] = pos;
    const col = won ? GOLD : DIM;
    return (
      <g>
        {won && <circle cx={cx} cy={cy} r={r + 6} fill={GOLD} opacity="0.18" />}
        {won && <circle cx={cx} cy={cy} r={r + 3} fill={GOLD} opacity="0.30" />}
        <circle cx={cx} cy={cy} r={r} fill={col} />
      </g>
    );
  }

  const r32Dots = Array.from({ length: 16 }, (_, k) => (
    <Dot key={`r32d-${k}`} pos={jPos(0, k)} won={!!slotW[k]} r={4} />
  ));
  const r16Dots = Array.from({ length: 8 }, (_, k) => (
    <Dot key={`r16d-${k}`} pos={jPos(1, k)} won={!!r16W?.[CIR_R16[k]]} r={5} />
  ));
  const qfDots = Array.from({ length: 4 }, (_, k) => (
    <Dot key={`qfd-${k}`} pos={jPos(2, k)} won={!!qfW?.[k]} r={6} />
  ));
  const sfDots = Array.from({ length: 2 }, (_, k) => (
    <Dot key={`sfd-${k}`} pos={jPos(3, k)} won={!!sfW?.[k]} r={8} />
  ));

  // ── find winner entry for centre circle ───────────────────────────────────
  const winCode = flagCode(finalW);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, margin: '0 auto' }}>

        {/* ── SVG layer: background, lines, dots, title ── */}
        <svg width={SIZE} height={SIZE} style={{ position: 'absolute', top: 0, left: 0 }}>
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

          {/* Title */}
          <text x={CX} y={22} textAnchor="middle" fill="#475569"
            fontSize="10" fontFamily="system-ui,sans-serif" letterSpacing="3" fontWeight="600">
            2026 FIFA WORLD CUP
          </text>
          <text x={CX} y={38} textAnchor="middle" fill="#374151"
            fontSize="9" fontFamily="system-ui,sans-serif" letterSpacing="2">
            KNOCKOUTS
          </text>

          {/* Lines — back to front */}
          {sfLines}
          {qfLines}
          {r16Lines}
          {r32Lines}
          {flagLines}

          {/* Dots */}
          {r32Dots}
          {r16Dots}
          {qfDots}
          {sfDots}

          {/* Gold glow behind winning flag positions (rendered under HTML layer) */}
          {slots.filter(s => s.won).map(({ i }) => {
            const [fx, fy] = flagPos(i);
            return (
              <g key={`glow-${i}`}>
                <circle cx={fx} cy={fy} r={FR + 14} fill={GOLD} opacity="0.12" />
                <circle cx={fx} cy={fy} r={FR + 7}  fill={GOLD} opacity="0.22" />
              </g>
            );
          })}

          {/* Gold glow behind winner centre */}
          {finalW && <>
            <circle cx={CX} cy={CY} r={WIN_RAD + 22} fill={GOLD} opacity="0.09" />
            <circle cx={CX} cy={CY} r={WIN_RAD + 12} fill={GOLD} opacity="0.17" />
          </>}
        </svg>

        {/* ── HTML layer: flag circles ── */}
        {slots.map(({ i, code, won, lost }) => {
          const [fx, fy] = flagPos(i);
          const border = won  ? `3px solid ${GOLD}`
                       : lost ? '2px solid #1f2937'
                       :        '2px solid #334155';
          return (
            <div key={`flag-${i}`} style={{
              position: 'absolute',
              left: fx - FR,
              top:  fy - FR,
              width:  FR * 2,
              height: FR * 2,
              borderRadius: '50%',
              overflow: 'hidden',
              border,
              opacity: lost ? 0.18 : 1,
              boxSizing: 'border-box',
              background: '#1e293b',
            }}>
              {code && (
                <img src={`${BASE}flags/${code}.svg`} alt={code}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
            </div>
          );
        })}

        {/* ── centre winner circle ── */}
        <div style={{
          position: 'absolute',
          left: CX - WIN_RAD,
          top:  CY - WIN_RAD,
          width:  WIN_RAD * 2,
          height: WIN_RAD * 2,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `4px solid ${finalW ? GOLD : '#1e3a5f'}`,
          boxSizing: 'border-box',
          boxShadow: finalW ? `0 0 18px ${GOLD}, 0 0 36px ${GOLD}55` : 'none',
          background: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {winCode
            ? <img src={`${BASE}flags/${winCode}.svg`} alt={winCode}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 36 }}>🏆</span>
          }
        </div>
      </div>
    </div>
  );
}
