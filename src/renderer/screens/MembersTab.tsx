import { useEffect, useId, useState } from 'react';
import { LEVELS, type Level } from '../../core/domain/types';
import { MEMBER_QUERY_MAX } from '../../core/social/people';
import { AREAS, PROFILE_LIMITS, type Area } from '../../core/social/types';
import { EmptyState, Select, TextField } from '../design-system';
import { api, unwrap } from '../lib/api';
import { KNOWN_STACKS } from '../lib/stack-icons';
import { AREA_LABELS } from './forms';
import { PagedMembers } from './PagedMembers';

const SEARCH_DELAY_MS = 300;

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Everyone in the community you can see, closest English level first, with filters. */
export function MembersTab() {
  const stackList = useId();
  const [query, setQuery] = useState('');
  const [stack, setStack] = useState('');
  const [level, setLevel] = useState<'' | Level>('');
  const [area, setArea] = useState<'' | Area>('');
  const q = useDebounced(query.trim(), SEARCH_DELAY_MS);
  const s = useDebounced(stack.trim(), SEARCH_DELAY_MS);
  const filters = { query: q || undefined, level: level || undefined, area: area || undefined, stack: s || undefined };

  return (
    <section className="members" aria-label="Members">
      <div className="member-filters">
        <TextField label="Search by name" type="search" value={query} maxLength={MEMBER_QUERY_MAX} spellCheck={false}
          onChange={(e) => setQuery(e.target.value)} />
        <Select label="English level" value={level} onChange={(e) => setLevel(e.target.value as '' | Level)}
          options={[{ value: '', label: 'Any level' }, ...LEVELS.map((l) => ({ value: l, label: l }))]} />
        <Select label="Area" value={area} onChange={(e) => setArea(e.target.value as '' | Area)}
          options={[{ value: '', label: 'Any area' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))]} />
        <TextField label="Technology" value={stack} maxLength={PROFILE_LIMITS.stackTagLength} spellCheck={false} list={stackList}
          onChange={(e) => setStack(e.target.value)} placeholder="Python, React…" />
        <datalist id={stackList}>{KNOWN_STACKS.map((k) => <option key={k} value={k} />)}</datalist>
      </div>
      <PagedMembers
        reloadKey={JSON.stringify(filters)}
        label="Members"
        load={(page) => api().social.members({ ...filters, page }).then(unwrap)}
        empty={<EmptyState title="No members match these filters." body="Try another level or area, or clear the search." />}
      />
    </section>
  );
}
