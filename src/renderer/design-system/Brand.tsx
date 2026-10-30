import { DuckMark } from './DuckMark';

/**
 * The brand line: the small duck and "DevTalk" as text, so the accessible name is the visible name. In the rail and at
 * the top of the first-run screens. At 24 px the duck is the size of the official lockup next to 15 px type.
 */
export function Brand() {
  return (
    <div className="brand">
      <DuckMark variant="small" size={24} />
      DevTalk
    </div>
  );
}
