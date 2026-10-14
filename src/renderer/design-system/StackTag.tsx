import { stackIconFor } from '../lib/stack-icons';

/** A technology on a profile: its name, decorated with its logo in the text colour when one is known. */
export function StackTag({ tag }: { tag: string }) {
  const icon = stackIconFor(tag);
  return (
    <span className="stack-tag">
      {icon && (
        <svg className="stack-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path d={icon.path} />
        </svg>
      )}
      <span>{icon ? icon.label : tag}</span>
    </span>
  );
}

export function StackList({ tags }: { tags: string[] }) {
  return (
    <ul className="stack-list">
      {tags.map((t) => (
        <li key={t}><StackTag tag={t} /></li>
      ))}
    </ul>
  );
}
