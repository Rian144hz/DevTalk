/** Pencil tally marks in groups of five, so recurrence reads without a dashboard of numbers. */
export function Tally({ count, label }: { count: number; label: string }) {
  const groups: number[] = [];
  for (let left = count; left > 0; left -= 5) groups.push(Math.min(5, left));
  return (
    <span className="tally" role="img" aria-label={label}>
      {groups.map((n, g) => (
        <span className="tally-group" key={g}>
          {Array.from({ length: Math.min(n, 4) }, (_, i) => <i key={i} />)}
          {n === 5 && <b />}
        </span>
      ))}
    </span>
  );
}
