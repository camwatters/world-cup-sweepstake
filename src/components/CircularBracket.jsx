// Circular (wheel) bracket: R32 on the outer ring, converging inward to the Final at centre.
//
// Angular layout (0° = top, clockwise):
//   R32 schedule slot i  →  arc at i×11.25° (32 slots, 16 matches)
//   R16 ring             →  16 arcs of 22.5° (one per R32 winner)
//   QF  ring             →  8 arcs of 45°   (one per R16 winner)
//   SF  ring             →  4 arcs of 90°   (one per QF winner)
//   Final ring           →  2 arcs of 180°  (one per SF winner)
//   Centre circle        →  champion
//
// Bracket connectivity (sequential slot order maps cleanly to the tournament structure):
//   R16 pair k (arcs 2k, 2k+1) → r16W[ CIR_R16[k] ]
//   QF  pair k (arcs 2k, 2k+1) → qfW [ k ]
//   SF  pair k (arcs 2k, 2k+1) → sfW [ k ]

const CIR_R16 = [0, 1, 4, 5, 2, 3, 6, 7]; // circular R16-pair-index → r16W array index
const GAP = 0.6; // degrees gap between adjacent arcs

function toXY(cx, cy, deg, r) {
  const rad = (deg - 90) * (Math.PI / 180);
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

function arc(cx, cy, r1, r2, s, e) {
  const [x1, y1] = toXY(cx, cy, s + GAP, r2);
  const [x2, y2] = toXY(cx, cy, e - GAP, r2);
  const [x3, y3] = toXY(cx, cy, e - GAP, r1);
  const [x4, y4] = toXY(cx, cy, s + GAP, r1);
  const sw = (e - s - GAP * 2) > 180 ? 1 : 0;
  return `M${x1} ${y1}A${r2} ${r2} 0 ${sw} 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 ${sw} 0 ${x4} ${y4}Z`;
}

// Radial text rotation — flip on the left half so text is never upside-down
function rot(mid) {
  const base = mid - 90;
  return mid > 90 && mid <= 270 ? base + 180 : base;
}

function abbr(name) {
  if (!name) return '?';
  const w = name.trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 3).toUpperCase();
  if (w.length === 2) return (w[0].slice(0, 2) + w[1][0]).toUpperCase();
  return w.map(x => x[0]).join('').slice(0, 3).toUpperCase();
}

function same(a, b) {
  return !!(a && b && a.toLowerCase() === b.toLowerCase());
}

const C = {
  bg:      '#0f172a',
  tbd:     '#1e3a5f',
  adv:     '#1e40af',
  won:     '#14532d',
  lost:    '#1f2937',
  final:   '#78350f',
  champ:   '#92400e',
  sep:     '#0f172a',
  tText:   '#93c5fd',
  wText:   '#86efac',
  lText:   '#4b5563',
  fText:   '#fde68a',
};

export default function CircularBracket({ resolvedR32, slotW, r16W, qfW, sfW, pairWinner }) {
  const SIZE = 640;
  const CX = SIZE / 2, CY = SIZE / 2;

  // Ring [innerR, outerR]
  const R = {
    r32:   [224, 295],
    r16:   [166, 219],
    qf:    [112, 161],
    sf:    [63,  107],
    fin:   [22,  58],
  };
  const WIN = 22;

  const finalW = sfW ? pairWinner(sfW[0], sfW[1]) : null;

  function teamColor(team, winner) {
    if (!team) return C.tbd;
    if (!winner) return C.adv;
    return same(team, winner) ? C.won : C.lost;
  }
  function textColor(team, winner, isFinal) {
    if (!team) return C.tText;
    if (!winner) return C.tText;
    if (same(team, winner)) return isFinal ? C.fText : C.wText;
    return C.lText;
  }

  function ArcLabel({ i, total, ri, ro, name, fill, tFill, fontSize, fw }) {
    const step = 360 / total;
    const s = i * step, e = s + step, mid = (s + e) / 2;
    const [tx, ty] = toXY(CX, CY, mid, (ri + ro) / 2);
    return (
      <g>
        <path d={arc(CX, CY, ri, ro, s, e)} fill={fill} />
        {name && (
          <text x={tx} y={ty} fill={tFill} fontSize={fontSize}
            fontFamily="system-ui,sans-serif" fontWeight={fw ?? 'normal'}
            textAnchor="middle" dominantBaseline="middle"
            transform={`rotate(${rot(mid)},${tx},${ty})`}>
            {name}
          </text>
        )}
      </g>
    );
  }

  // R32 ring — 32 arcs (2 per match)
  const r32Arcs = resolvedR32.flatMap(({ home, away }, mi) => {
    const w = slotW[mi];
    return [
      { slot: mi * 2, name: home.team || home.label, winner: w, isHome: true },
      { slot: mi * 2 + 1, name: away.team || away.label, winner: w, isHome: false },
    ].map(({ slot, name, winner }) => {
      const fill = teamColor(name, winner);
      const tFill = textColor(name, winner, false);
      return <ArcLabel key={`r32-${slot}`} i={slot} total={32}
        ri={R.r32[0]} ro={R.r32[1]} name={abbr(name)} fill={fill} tFill={tFill} fontSize={7} />;
    });
  });

  // R16 ring — 16 arcs (slotW[i] at circular position i)
  const r16Arcs = Array.from({ length: 16 }, (_, i) => {
    const team = slotW[i];
    const r16Winner = r16W?.[CIR_R16[Math.floor(i / 2)]];
    const fill = teamColor(team || null, r16Winner);
    const tFill = textColor(team, r16Winner, false);
    return <ArcLabel key={`r16-${i}`} i={i} total={16}
      ri={R.r16[0]} ro={R.r16[1]} name={team ? abbr(team) : null}
      fill={fill} tFill={tFill} fontSize={8} />;
  });

  // QF ring — 8 arcs (r16W[CIR_R16[i]] at circular position i)
  const qfArcs = Array.from({ length: 8 }, (_, i) => {
    const team = r16W?.[CIR_R16[i]];
    const qfWinner = qfW?.[Math.floor(i / 2)];
    const fill = teamColor(team || null, qfWinner);
    const tFill = textColor(team, qfWinner, false);
    return <ArcLabel key={`qf-${i}`} i={i} total={8}
      ri={R.qf[0]} ro={R.qf[1]} name={team ? abbr(team) : null}
      fill={fill} tFill={tFill} fontSize={9.5} />;
  });

  // SF ring — 4 arcs (qfW[i])
  const sfArcs = Array.from({ length: 4 }, (_, i) => {
    const team = qfW?.[i];
    const sfWinner = sfW?.[Math.floor(i / 2)];
    const fill = teamColor(team || null, sfWinner);
    const tFill = textColor(team, sfWinner, false);
    return <ArcLabel key={`sf-${i}`} i={i} total={4}
      ri={R.sf[0]} ro={R.sf[1]} name={team ? abbr(team) : null}
      fill={fill} tFill={tFill} fontSize={11} fw="600" />;
  });

  // Final ring — 2 arcs (sfW[i])
  const finArcs = [sfW?.[0], sfW?.[1]].map((team, i) => {
    const fill = !team ? C.tbd : !finalW ? C.final : same(team, finalW) ? C.champ : C.lost;
    const tFill = !team ? C.tText : same(team, finalW) ? C.fText : C.lText;
    return <ArcLabel key={`fin-${i}`} i={i} total={2}
      ri={R.fin[0]} ro={R.fin[1]} name={team ? abbr(team) : null}
      fill={fill} tFill={tFill} fontSize={13} fw="bold" />;
  });

  // Round ring labels (tiny, at outer edge of each ring)
  const ringLabels = [
    { label: 'R32',    r: R.r32[1] + 9,  deg: 0 },
    { label: 'R16',    r: R.r16[1] + 9,  deg: 0 },
    { label: 'QF',     r: R.qf[1]  + 9,  deg: 0 },
    { label: 'SF',     r: R.sf[1]  + 9,  deg: 0 },
    { label: 'FINAL',  r: R.fin[1] + 9,  deg: 0 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width="100%" viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ maxWidth: 620, display: 'block' }}>
        <rect width={SIZE} height={SIZE} fill={C.bg} />

        {/* Subtle ring borders */}
        {[R.r32[0], R.r16[0], R.qf[0], R.sf[0], R.fin[0]].map(r => (
          <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke={C.sep} strokeWidth="2" />
        ))}

        {r32Arcs}
        {r16Arcs}
        {qfArcs}
        {sfArcs}
        {finArcs}

        {/* Centre winner circle */}
        <circle cx={CX} cy={CY} r={WIN} fill={finalW ? C.champ : C.tbd} />
        <text x={CX} y={CY} fill={finalW ? C.fText : '#6b7280'} fontSize={finalW ? 8 : 14}
          textAnchor="middle" dominantBaseline="middle"
          fontFamily="system-ui,sans-serif" fontWeight="bold">
          {finalW ? abbr(finalW) : '★'}
        </text>

        {/* Ring labels at top of each ring */}
        {ringLabels.map(({ label, r }) => {
          const [tx, ty] = toXY(CX, CY, 0, r);
          return (
            <text key={label} x={tx} y={ty} fill="#64748b" fontSize="7"
              textAnchor="middle" dominantBaseline="auto"
              fontFamily="system-ui,sans-serif">
              {label}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          [C.tbd,  C.tText, 'TBD / upcoming'],
          [C.adv,  C.tText, 'Advancing'],
          [C.won,  C.wText, 'Advanced'],
          [C.lost, C.lText, 'Eliminated'],
          [C.champ,C.fText, 'Champion'],
        ].map(([bg, tc, label]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: tc }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: bg, flexShrink: 0 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
