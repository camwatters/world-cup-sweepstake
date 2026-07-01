// Circular wheel bracket.
// Outer ring: 32 flag circles (one per R32 team slot).
// Each round converges inward via bracket tree lines to the centre.
//
// Bracket connectivity — sequential slot order maps exactly to the structure:
//   R16 circular pair k  →  r16W[ CIR_R16[k] ]
//   QF  circular pair k  →  qfW[k]
//   SF  circular pair k  →  sfW[k]

const CIR_R16 = [0, 1, 4, 5, 2, 3, 6, 7];

const GOLD  = '#f59e0b';
const BLUE  = '#60a5fa';
const DIM   = '#1e3a5f';
const DEAD  = '#0f172a';
const WHITE = '#f1f5f9';

function xy(cx, cy, deg, r) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

function same(a, b) {
  return !!(a && b && a.toLowerCase() === b.toLowerCase());
}

// Midpoint angle of a bracket sub-tree at this level and index.
// Teams are evenly spaced at slot * (360/32).
function junDeg(level, k) {
  const tpj = Math.pow(2, level + 1);   // teams covered: 2, 4, 8, 16
  const mid  = k * tpj + (tpj - 1) / 2;
  return mid * (360 / 32);
}

function edgeState(teamAtNode, nextWinner) {
  if (!teamAtNode) return 'none';
  if (!nextWinner) return 'active';
  return same(teamAtNode, nextWinner) ? 'won' : 'lost';
}

function lineColor(state) {
  if (state === 'won')    return GOLD;
  if (state === 'active') return BLUE;
  if (state === 'lost')   return DEAD;
  return DIM;
}
const LW = { won: 2.5, active: 2, lost: 1.5, none: 1.5 };

// ─── main component ───────────────────────────────────────────────

export default function CircularBracket({ resolvedR32, slotW, r16W, qfW, sfW, pairWinner }) {
  const SIZE  = 720;
  const CX    = SIZE / 2;
  const CY    = SIZE / 2;
  const BASE  = import.meta.env.BASE_URL;

  const FLAG_R   = 318;  // centre of flag circles from origin
  const FLAG_RAD = 25;   // flag circle radius (50px diameter)
  const JR = [252, 200, 150, 103]; // junction radii: R32, R16, QF, SF
  const WIN_RAD  = 40;   // winner circle radius

  const finalW = sfW ? pairWinner(sfW[0], sfW[1]) : null;

  function flagUrl(code) {
    return code ? `${BASE}flags/${code}.svg` : null;
  }

  // Build per-slot data for all 32 R32 team positions
  const slots = Array.from({ length: 32 }, (_, i) => {
    const mi    = Math.floor(i / 2);
    const side  = i % 2 === 0 ? resolvedR32[mi].home : resolvedR32[mi].away;
    const name  = side.team || null;
    const code  = side.entry?.flag || null;
    const w     = slotW[mi];
    const won   = !!(w && name && same(name, w));
    const lost  = !!(w && name && !same(name, w));
    return { i, mi, name, code, won, lost };
  });

  // Positions
  function flagPos(slot) { return xy(CX, CY, slot * 11.25, FLAG_R); }
  function flagInner(slot) {
    return xy(CX, CY, slot * 11.25, FLAG_R - FLAG_RAD - 3);
  }
  function jPos(level, k) { return xy(CX, CY, junDeg(level, k), JR[level]); }

  // ── lines: flag → R32 junction ──────────────────────────────────
  const flagLines = slots.map(({ i, mi, name, won, lost }) => {
    const [x1, y1] = flagInner(i);
    const [x2, y2] = jPos(0, mi);
    const state = won ? 'won' : lost ? 'lost' : name ? 'active' : 'none';
    return <line key={`fl-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(state)} strokeWidth={LW[state]} strokeLinecap="round" />;
  });

  // ── lines: R32 junction → R16 junction ──────────────────────────
  const r32Lines = Array.from({ length: 16 }, (_, k) => {
    const [x1, y1] = jPos(0, k);
    const r16K     = Math.floor(k / 2);
    const [x2, y2] = jPos(1, r16K);
    const r32w     = slotW[k];
    const r16w     = r16W?.[CIR_R16[r16K]];
    const state    = edgeState(r32w, r16w);
    return <line key={`r32l-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(state)} strokeWidth={LW[state]} strokeLinecap="round" />;
  });

  // ── lines: R16 junction → QF junction ───────────────────────────
  const r16Lines = Array.from({ length: 8 }, (_, k) => {
    const [x1, y1] = jPos(1, k);
    const qfK      = Math.floor(k / 2);
    const [x2, y2] = jPos(2, qfK);
    const r16w     = r16W?.[CIR_R16[k]];
    const qfw      = qfW?.[qfK];
    const state    = edgeState(r16w, qfw);
    return <line key={`r16l-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(state)} strokeWidth={LW[state]} strokeLinecap="round" />;
  });

  // ── lines: QF junction → SF junction ────────────────────────────
  const qfLines = Array.from({ length: 4 }, (_, k) => {
    const [x1, y1] = jPos(2, k);
    const sfK      = Math.floor(k / 2);
    const [x2, y2] = jPos(3, sfK);
    const qfw      = qfW?.[k];
    const sfw      = sfW?.[sfK];
    const state    = edgeState(qfw, sfw);
    return <line key={`qfl-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={lineColor(state)} strokeWidth={LW[state]} strokeLinecap="round" />;
  });

  // ── lines: SF junction → centre ─────────────────────────────────
  const sfLines = Array.from({ length: 2 }, (_, k) => {
    const [x1, y1] = jPos(3, k);
    const sfw      = sfW?.[k];
    const state    = edgeState(sfw, finalW);
    return <line key={`sfl-${k}`} x1={x1} y1={y1} x2={CX} y2={CY}
      stroke={lineColor(state)} strokeWidth={LW[state]} strokeLinecap="round" />;
  });

  // ── junction dots ────────────────────────────────────────────────
  function Dot({ pos, state, r }) {
    const [cx, cy] = pos;
    const col = lineColor(state);
    const glow = state === 'won' || state === 'active';
    return (
      <g>
        {glow && <circle cx={cx} cy={cy} r={r + 5} fill={col} opacity="0.18" />}
        {glow && <circle cx={cx} cy={cy} r={r + 2} fill={col} opacity="0.30" />}
        <circle cx={cx} cy={cy} r={r} fill={col} />
      </g>
    );
  }

  const r32Dots = Array.from({ length: 16 }, (_, k) => (
    <Dot key={`r32d-${k}`} pos={jPos(0, k)}
      state={slotW[k] ? 'won' : 'none'} r={4} />
  ));
  const r16Dots = Array.from({ length: 8 }, (_, k) => (
    <Dot key={`r16d-${k}`} pos={jPos(1, k)}
      state={r16W?.[CIR_R16[k]] ? 'won' : r16W ? 'none' : 'none'} r={5} />
  ));
  const qfDots = Array.from({ length: 4 }, (_, k) => (
    <Dot key={`qfd-${k}`} pos={jPos(2, k)}
      state={qfW?.[k] ? 'won' : 'none'} r={6} />
  ));
  const sfDots = Array.from({ length: 2 }, (_, k) => (
    <Dot key={`sfd-${k}`} pos={jPos(3, k)}
      state={sfW?.[k] ? 'won' : 'none'} r={8} />
  ));

  // ── flag circles ─────────────────────────────────────────────────
  const clipPaths = slots.map(({ i }) => {
    const [fx, fy] = flagPos(i);
    return (
      <clipPath key={i} id={`fc-${i}`}>
        <circle cx={fx} cy={fy} r={FLAG_RAD} />
      </clipPath>
    );
  });

  const flagCircles = slots.map(({ i, name, code, won, lost }) => {
    const [fx, fy] = flagPos(i);
    const r = FLAG_RAD;
    const url = flagUrl(code);
    const opacity = lost ? 0.2 : 1;
    const ring = won ? GOLD : lost ? '#1f2937' : '#334155';
    const ringW = won ? 3 : 2;

    return (
      <g key={`flag-${i}`} opacity={opacity}>
        {/* Outer glow for winners */}
        {won && <circle cx={fx} cy={fy} r={r + 12} fill={GOLD} opacity="0.12" />}
        {won && <circle cx={fx} cy={fy} r={r + 6}  fill={GOLD} opacity="0.22" />}
        {/* Ring */}
        <circle cx={fx} cy={fy} r={r + ringW} fill={ring} />
        {/* Flag fill */}
        <circle cx={fx} cy={fy} r={r} fill="#1e293b" />
        {url
          ? <image href={url} x={fx - r} y={fy - r} width={r * 2} height={r * 2}
              clipPath={`url(#fc-${i})`} preserveAspectRatio="xMidYMid slice" />
          : <text x={fx} y={fy} textAnchor="middle" dominantBaseline="middle"
              fontSize="10" fill="#64748b" fontFamily="system-ui">?</text>
        }
      </g>
    );
  });

  // ── centre winner ─────────────────────────────────────────────────
  const winEntry = finalW
    ? resolvedR32.flatMap(m => [m.home, m.away]).find(s => s.team && same(s.team, finalW))
    : null;
  const winUrl = flagUrl(winEntry?.entry?.flag);

  const centre = (
    <g>
      {finalW && <>
        <circle cx={CX} cy={CY} r={WIN_RAD + 24} fill={GOLD} opacity="0.10" />
        <circle cx={CX} cy={CY} r={WIN_RAD + 12} fill={GOLD} opacity="0.18" />
        <circle cx={CX} cy={CY} r={WIN_RAD + 5}  fill={GOLD} />
      </>}
      {!finalW && <circle cx={CX} cy={CY} r={WIN_RAD + 5} fill="#1e3a5f" />}
      <clipPath id="centre-clip">
        <circle cx={CX} cy={CY} r={WIN_RAD} />
      </clipPath>
      <circle cx={CX} cy={CY} r={WIN_RAD} fill="#0f172a" />
      {winUrl
        ? <image href={winUrl} x={CX - WIN_RAD} y={CY - WIN_RAD}
            width={WIN_RAD * 2} height={WIN_RAD * 2}
            clipPath="url(#centre-clip)" preserveAspectRatio="xMidYMid slice" />
        : <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize="32" fontFamily="system-ui">🏆</text>
      }
    </g>
  );

  // ── title ─────────────────────────────────────────────────────────
  const titleElem = (
    <g>
      <text x={CX} y={22} textAnchor="middle" fill="#475569"
        fontSize="10" fontFamily="system-ui,sans-serif" letterSpacing="3" fontWeight="600">
        2026 FIFA WORLD CUP
      </text>
      <text x={CX} y={38} textAnchor="middle" fill="#64748b"
        fontSize="9" fontFamily="system-ui,sans-serif" letterSpacing="2">
        KNOCKOUTS
      </text>
    </g>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ maxWidth: SIZE, display: 'block', borderRadius: 16 }}>

        <defs>
          <radialGradient id="cb-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#172035" />
            <stop offset="70%"  stopColor="#0d1525" />
            <stop offset="100%" stopColor="#070c18" />
          </radialGradient>
          {clipPaths}
        </defs>

        <rect width={SIZE} height={SIZE} fill="url(#cb-bg)" rx="16" />
        {titleElem}

        {/* Subtle guide rings */}
        {[FLAG_R, ...JR, WIN_RAD + 5].map(r => (
          <circle key={r} cx={CX} cy={CY} r={r}
            fill="none" stroke="#ffffff" strokeWidth="0.3" opacity="0.06" />
        ))}

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

        {/* Flag circles & centre (on top) */}
        {flagCircles}
        {centre}
      </svg>
    </div>
  );
}
