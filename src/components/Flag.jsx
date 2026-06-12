const SPECIAL = {
  "gb-eng": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "gb-sct": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

function toEmoji(code) {
  if (SPECIAL[code]) return SPECIAL[code];
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))).join("");
}

export default function Flag({ code, size = 32 }) {
  return (
    <span
      style={{ fontSize: size * 0.9, lineHeight: 1, display: "inline-block" }}
      role="img"
      aria-label={code}
    >
      {toEmoji(code)}
    </span>
  );
}
