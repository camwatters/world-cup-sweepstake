export default function Flag({ code, size = 32 }) {
  return (
    <img
      src={`https://flagcdn.com/w${size * 2}/${code}.png`}
      width={size * 1.5}
      height={size}
      alt={code}
      style={{ objectFit: "cover", borderRadius: 2 }}
      loading="lazy"
    />
  );
}
