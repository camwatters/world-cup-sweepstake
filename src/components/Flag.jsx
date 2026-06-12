export default function Flag({ code, size = 32 }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}flags/${code}.svg`}
      width={size * 1.5}
      height={size}
      alt={code}
      style={{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
    />
  );
}
