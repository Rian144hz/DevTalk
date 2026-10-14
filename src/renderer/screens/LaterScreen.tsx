import { EmptyState } from '../design-system';

const COPY = {
  rooms: { title: 'Rooms', body: 'Soon you will be able to join scheduled voice rooms with timed turns: mock stand-ups, code review role play and interview practice.' },
} as const;

export function LaterScreen({ which }: { which: keyof typeof COPY }) {
  return (
    <main className="page">
      <header className="page-head"><h1>{COPY[which].title}</h1></header>
      <EmptyState title="Coming in a later version" body={COPY[which].body} />
    </main>
  );
}
