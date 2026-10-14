// Circular wheel bracket.
// Architecture: single responsive SVG (viewBox) with <foreignObject> for flag images.
// foreignObject scales with the SVG viewBox so flags are correct on all screen sizes.
// touch-action on the wrapper enables native mobile pinch-to-zoom/pan.
//
// Bracket connectivity — sequential slot order maps exactly:
//   R16 circular pair k  →  r16W[ CIR_R16[k] ]
//   QF  circular pair k  →  qfW[k]
//   SF  circular pair k  →  sfW[k]

import { findEntry } from '../utils/espn';

const CIR_R16 = [0, 1, 4, 5, 2, 3, 6, 7];

const flagUrl = name => {
  const code = findEntry(name)?.flag;
  return code ? `${import.meta.env.BASE_URL}flags/${code}.svg` : null;
};
const IMG_STYLE = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

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

function edge(key, [x1, y1], [x2, y2], s) {
  return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2}
    stroke={lineColor(s)} strokeWidth={LW[s]} strokeLinecap="round" />;
}

// Junction dot — shows the winner's flag as a trail marker once known.
function junctionFlag(key, [cx, cy], winner, r) {
  const url = winner ? flagUrl(winner) : null;
  if (!url) return <circle key={key} cx={cx} cy={cy} r={r * 0.45} fill={DIM} />;
  return (
    <g key={key}>
      <circle cx={cx} cy={cy} r={r + 7} fill={GOLD} opacity="0.15" />
      <circle cx={cx} cy={cy} r={r + 3} fill={GOLD} opacity="0.28" />
      <circle cx={cx} cy={cy} r={r + 1.5} fill={GOLD} />
      <foreignObject x={cx - r} y={cy - r} width={r * 2} height={r * 2}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#1e293b' }}>
          <img src={url} alt="" style={IMG_STYLE} />
        </div>
      </foreignObject>
    </g>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function CircularBracket({ resolvedR32, slotW, r16W, qfW, sfW, pairWinner }) {
  const SIZE     = 700;
  const CX       = SIZE / 2;
  const CY       = SIZE / 2;

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
    const w    = slotW[mi];
    const won  = !!(w && name && same(name, w));
    const lost = !!(w && name && !same(name, w));
    return { i, mi, name, url: flagUrl(name), won, lost };
  });

  // ── bracket lines ─────────────────────────────────────────────────────────

  // flag → R32 junction
  const flagLines = slots.map(({ i, mi, name, lost }) =>
    edge(`fl-${i}`, flagInner(i), jPos(0, mi), lost ? 'lost' : name ? 'won' : 'none'));

  // R32 junction → R16 junction
  const r32Lines = Array.from({ length: 16 }, (_, k) =>
    edge(`r32l-${k}`, jPos(0, k), jPos(1, k >> 1), edgeState(slotW[k], r16W?.[CIR_R16[k >> 1]])));

  // R16 junction → QF junction
  const r16Lines = Array.from({ length: 8 }, (_, k) =>
    edge(`r16l-${k}`, jPos(1, k), jPos(2, k >> 1), edgeState(r16W?.[CIR_R16[k]], qfW?.[k >> 1])));

  // QF junction → SF junction
  const qfLines = Array.from({ length: 4 }, (_, k) =>
    edge(`qfl-${k}`, jPos(2, k), jPos(3, k >> 1), edgeState(qfW?.[k], sfW?.[k >> 1])));

  // SF junction → centre
  const sfLines = Array.from({ length: 2 }, (_, k) =>
    edge(`sfl-${k}`, jPos(3, k), [CX, CY], edgeState(sfW?.[k], finalW)));

  // ── junction dots ─────────────────────────────────────────────────────────
  const r32Dots = Array.from({ length: 16 }, (_, k) => junctionFlag(`r32d-${k}`, jPos(0, k), slotW[k], JFR[0]));
  const r16Dots = Array.from({ length: 8 },  (_, k) => junctionFlag(`r16d-${k}`, jPos(1, k), r16W?.[CIR_R16[k]], JFR[1]));
  const qfDots  = Array.from({ length: 4 },  (_, k) => junctionFlag(`qfd-${k}`,  jPos(2, k), qfW?.[k], JFR[2]));
  const sfDots  = Array.from({ length: 2 },  (_, k) => junctionFlag(`sfd-${k}`,  jPos(3, k), sfW?.[k], JFR[3]));

  // ── flag circles (foreignObject so they scale with the SVG viewBox) ─────────
  const flagCircles = slots.map(({ i, url, won, lost }) => {
    const [fx, fy] = flagPos(i);
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
            {url && <img src={url} alt="" style={IMG_STYLE} />}
          </div>
        </foreignObject>
      </g>
    );
  });

  // ── centre winner ─────────────────────────────────────────────────────────
  const winUrl = flagUrl(finalW);
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
            ? <img src={winUrl} alt="" style={IMG_STYLE} />
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
