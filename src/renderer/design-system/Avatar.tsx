/** A profile photo, or the first letter of the name in a circle. The name is always shown next to it. */
export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const style = { width: size, height: size };
  if (src) return <img className="avatar" src={src} alt="" width={size} height={size} style={style} />;
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase('en') ?? '?';
  return (
    <span className="avatar avatar-initial" aria-hidden="true" style={{ ...style, fontSize: Math.round(size * 0.42) }}>
      {initial}
    </span>
  );
}
